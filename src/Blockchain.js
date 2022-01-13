const SHA256 = require("crypto-js/sha256")
const EC = require('elliptic').ec;
const ec = new EC('secp256k1')
// NU E VERIFICAT DACA BALLANCE-UL CORESPUNDE CA SA FIE VALIDA O TRANZACTIE
class Transaction {
    constructor(fromAddress,toAddress,amount,signature = 0, nonce){
        this.fromAddress = fromAddress;
        this.toAddress = toAddress;
        this.amount = amount
        this.signature = signature
        this.nonce = nonce
    }

    CalculateHash(){
        return SHA256((this.fromAddress + this.toAddress + this.amount + this.nonce).replace(/(\r\n|\n|\r)/gm, "")).toString()
    }

    SignTransaction(signingKey){
        if(signingKey.getPublic('hex') !== this.fromAddress)
        {
            throw new Error("This is not your wallet!")
        }

        const hashTx = this.CalculateHash()
        const sig = signingKey.sign(hashTx,'base64')
        this.signature = sig.toDER('hex')
    }

    isValid(blockchain){
        if(this.fromAddress == null)
            return true
        if(!this.signature || this.signature.length == 0)
            return false
        if(this.amount > blockchain.GetBalanceOfAddress(this.fromAddress))
            return false
        // Check nonce
        var expected = 0
        for(var bl in blockchain.chain){
            for(var tr in bl.transactions){
                if(tr.fromAddress==this.fromAddress)
                    expected = tr.nonce;
            }
        }
        console.log("TEST" + this.nonce + " " + expected + " " + this.fromAddress)
        if(this.nonce != expected+1){
            return false;
        }
        const publicKey = ec.keyFromPublic(this.fromAddress,'hex');
        return publicKey.verify(this.CalculateHash(), this.signature)
    }

    equal(transaction){
        if(this.fromAddress===transaction.fromAddress && this.toAddress===transaction.toAddress && this.amount===transaction.amount && this.signature===transaction.signature)
            return true;
        return false;
    }
}

class Block {
    constructor(index,timestamp,transactions,prevHash,hash = this.CalculateHash(),nonce = 0){
        this.index = index
        this.nonce = nonce
        this.transactions = transactions
        this.prevHash = prevHash
        this.hash = hash
        this.timestamp = timestamp;
    }

    GetRandomNonce()
    {
        return Math.floor(Math.random() * 10000000000000000);
    }

    CalculateHash(){
        return SHA256(this.nonce + this.index + this.transactions + this.prevHash + this.timestamp).toString()
    }

    MineBlock(difficulty){
        console.log("Mining Block...")
        while(this.hash.substring(0,difficulty) !== Array(difficulty + 1).join("0"))
        {
            this.nonce = this.GetRandomNonce()
            this.hash = this.CalculateHash()
        }
         console.log("Hash of mined block: " + this.hash +"\n")   
    }

    HasValidTransactions(blockchain) {
        for(var tx of this.transactions){
            var tran = new Transaction()
            tran = Object.assign(tran, tx)
            if(blockchain.GetBalanceOfAddress(tran.fromAddress) < tran.amount)
                if(!tran.isValid(blockchain)){
                    return false
                }
        }

        return true;
    }
}

class BlockChain {
    AssignClass(obj){
        Object.assign(this, obj)
    }
    constructor(difficulty = 5,chain = [this.GenesisBlock()],pendingTransactions = [], miningReward = 10) {
        this.difficulty = difficulty;
        this.chain = chain;
        this.pendingTransactions = pendingTransactions;
        this.miningReward = miningReward;
    }

    GenesisBlock(){
        return new Block(0, "01/01/2022",[],"0000000000000000000000000000000000000000000000000000000000000000")
    }

    GetLastBlock(){
        return this.chain[this.chain.length - 1]
    }

    MinePendingTransaction(miningRewardAddress){
        // Clean invalid transactions
        for(var tr in this.pendingTransactions){
            var expected_nonce = 0
            var cur_nonce = tr.nonce;
            for(var bl in this.chain){
                for(var tran in bl.transactions){
                    if(tran.fromAddress==tr.fromAddress)
                        expected_nonce = tran.nonce;

                }
            }
            if(expected_nonce+1!=cur_nonce)
                this.pendingTransactions = this.pendingTransactions.splice(this.pendingTransactions.indexOf(tr),1);
        }
       
        let lastBlock = this.GetLastBlock()
        // Add the miner's reward
        var nonce = 0
        for(var bl in this.chain){
            for(var tr in bl.transactions){
                if(tr.fromAddress==miningRewardAddress)
                    nonce = tr.nonce;
            }
        }
        nonce+=1
        this.pendingTransactions.push(new Transaction(null,miningRewardAddress,this.miningReward,nonce))
        let block = new Block(lastBlock.index+1, Date.now(),this.pendingTransactions,lastBlock.hash)
        block.MineBlock(this.difficulty)
      
        this.pendingTransactions = []
        // console.log("Block mined\n")
        this.chain.push(block)
        
        return block;
   }

    VerifyAndPushMinedBlock(block){
        //console.log(block.hash.substring(0,this.difficulty) === Array(this.difficulty + 1).join("0") && block.hash === SHA256(block.nonce + block.transactions + block.prevHash + block.timestamp).toString())
        if(block.hash.substring(0,this.difficulty) === Array(this.difficulty + 1).join("0") && block.hash === SHA256(block.nonce + block.transactions + block.prevHash + block.timestamp).toString())
        {
            this.chain.push(block)
            console.log("Block added")
        }
            
        this.pendingTransactions = []
    }

    AddTransaction(transaction){
        if(!transaction.fromAddress || !transaction.toAddress)
            throw new Error("Missing address")
        
        if(!transaction.isValid(this))
            throw new Error("Invalid transaction")
       this.pendingTransactions.push(transaction)
   }

    GetBalanceOfAddress(address){
        let balance = 0;
        for(const block of this.chain){
            for (const transaction of block.transactions){
                if(transaction.toAddress == address)
                    balance += transaction.amount
                if(transaction.fromAddress == address)
                    balance -= transaction.amount
            }
        }
        return balance
   }

   IsChainValid(chain = 0){
        if(chain == 0){
            for(let i = 1; i < this.chain.length;i++){
                const currentBlock = this.chain[i]
                const previousBlock = this.chain[i-1]

                if(!currentBlock.HasValidTransactions(this)){
                    console.log("No valid transactions")
                    return false
                }
                
                if(currentBlock.hash !== currentBlock.CalculateHash()){
                    console.log("Hash not valid")
                    return false
                }

                if(currentBlock.prevHash !== previousBlock.hash){
                    // console.log(this.chain)
                    // console.log(currentBlock.prevHash)
                    // console.log(previousBlock.hash)
                    console.log("Previous not valid")
                    return false
                }
            }
       }        
        else {
            for(let i = 1; i < chain.length;i++){
                const currentBlock = chain[i]
                const previousBlock = chain[i-1]
                //console.log("test")
                //console.log(typeof(currentBlock))
                //console.log(currentBlock)
                if(!currentBlock.HasValidTransactions(this)){
                    // console.log("No valid transactions")
                    return false
                }
                
                if(currentBlock.hash !== currentBlock.CalculateHash()){
                    // console.log("Hash not valid")
                    return false
                }

                if(currentBlock.prevHash !== previousBlock.hash){
                    // console.log("Previous not valid")
                    return false
                }
            }

        }
        return true;
   }
}

module.exports.BlockChain = BlockChain;
module.exports.Block = Block;
module.exports.Transaction = Transaction;
