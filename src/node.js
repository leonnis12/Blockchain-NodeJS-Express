const express = require('express')
const axios = require('Axios')
const EC = require('elliptic').ec;
const ec = new EC('secp256k1')
var bodyParser = require('body-parser')
const {Transaction, BlockChain, Block} = require('./Blockchain')
const Signature = require('elliptic/lib/elliptic/ec/signature')
const { Worker, isMainThread, workerData } = require('worker_threads');


const app = express()
const port = process.argv.slice(2)[0]

app.use( bodyParser.json() );       // to support JSON-encoded bodies
app.use(bodyParser.urlencoded({     // to support URL-encoded bodies
  extended: true
})); 

if(port=="3000")
  networkList = ["http://localhost:3001"]
else{
  networkList = ["http://localhost:3000"]
}

// Driver code
class Client{
  constructor(){
    this.bc = new BlockChain();
    this.CreateWallet()
  }
 
  CreateWallet() {
      this.myKey = ec.genKeyPair();
      this.publicKey = this.myKey.getPublic('hex');
  }
}
let client = new Client()
app.listen(port, () => {
  console.log(`Listening at http://localhost:${port}`)
})

// Gets the public/private key pair of the loaded wallet
app.get("/GetWalletData", (req,res) => {
  res.json({publicKey: client.publicKey,privateKey:client.myKey.getPrivate()})
})

// Get ballance of an address
app.post("/getBalanceOfAddress", (request,response) => {
  // console.log(!IsEmpty(request.body))
  if(!IsEmpty(request.body)) 
    response.json({balance: client.bc.GetBalanceOfAddress(request.body.address)})
  else
    response.json({balance: client.bc.GetBalanceOfAddress(client.publicKey)})
  
})

// Receive new transactions to be added from other nodes
app.post("/receiveTransaction", (req,res) => {
  var tmp = new Transaction()
  tmp = Object.assign(tmp, req.body.transaction)
  console.log(tmp)
  client.bc.AddTransaction(tmp)
  // If mining, restart the service to use the new blockchain
  if (miningWorker_active==true)
    restartMineService();
  res.send("Transaction Added")
  
})


// Adds transaction to pending list
app.post('/addTransaction',(req,res) => {
  //In the request there will be the fromAddress, the toAddress and the amount, than the transaction will be signed here
  console.log(req.body)
  var transaction = new Transaction()
  transaction = Object.assign(transaction, req.body)
  var nonce = 0
  for(var bl in client.bc.chain){
      for(var tr in bl){
          if(tr.fromAddress==transaction.fromAddress)
            nonce = tr.nonce;
      }
  }
  nonce+=1
  transaction.nonce = nonce;
  console.log(transaction)
  transaction.SignTransaction(client.myKey)
  if(client.bc.GetBalanceOfAddress(client.publicKey) < transaction.amount)
    res.send("Insufficient funds")
  else {
    client.bc.AddTransaction(transaction)
    for(var i=0; i<networkList.length; i++){
      var peer = networkList[i];
      axios.post(peer+"/receiveTransaction",{"transaction":transaction}).then((res) => {}, (error) => {});
    }
    // If mining, restart the service to use the new blockchain
    if (miningWorker_active==true)
      restartMineService();
    res.send("Transaction added")
  }


})

// Returns the whole blockchain
app.get('/getBlockchain',(req,res) => {
  res.json(client.bc)
  // if(req.body.blockNumber < client.bc.chain.length)
  //   res.json(client.bc)
})

// Returns the height of the current chain
app.get('/getHeight',(req,res) => {
  var tmp = client.bc.chain[1]
  console.log(tmp.nonce + tmp.index + tmp.transactions + tmp.prevHash + tmp.timestamp)
  res.json(client.bc.chain[client.bc.chain.length-1].index)
})

// Returns a block from the current chain or error
app.get('/getBlock',(req,res) => {
  id = req.query["id"]
  if(id && client.bc.chain[id]){
    res.json({"block": client.bc.chain[id]});
    return;
  }
  res.status(404).send({message: 'Error'});
})

// Synchronizes the blockchain from other peers
app.get('/syncWithNetwork',async function(req,res){
    SyncWithNetwork()
    res.json("Fully synchronized")
})

SyncWithNetwork = async () => {
    stopMineService();
    current = client.bc.chain[client.bc.chain.length - 1]
    cur_height = current.index;
    height = cur_height

    // Get the biggest height from peers
    for(var i=0; i<networkList.length; i++){
      var peer = networkList[i];
      await axios.get(peer+"/getHeight").then((res) => {
        if(res.data > height)
          height = res.data;
      }, (error) => {
        console.log(error);
      });
    }
    
    if(height > cur_height)
      client.bc.chain = []

    // Get the blocks from peers
    while(height > cur_height){
      var found = false;
      for(var i=0; i<networkList.length; i++){
        var peer = networkList[i];
        // Try to add the block from the peer
        await axios.get(peer+"/getBlock?id="+(cur_height+1)).then((res) => {
          // Initialize the transactions from the request
          var transactions = []
          for (var i=0; i<res.data.block.transactions.length;i++){
            var trans = res.data.block.transactions[i];
            var tmp = new Transaction()
            tmp = Object.assign(tmp, trans)
            transactions.push(tmp)
          }
          new_block = new Block(res.data.block.index, res.data.block.timestamp, transactions,res.data.block.prevHash, res.data.block.hash, res.data.block.nonce)
          client.bc.chain.push(new_block)
          if(client.bc.IsChainValid()){
            found=true;
            cur_height+=1;
          }
          else{
            client.bc.chain.pop();
          }
        }, (error) => {
          console.log(error);
        });
        // If a peer added the block, skip the other peers
        if(found)
          break;
      }
    }

    // If mining, restart the service to use the new blockchain
    if (miningWorker_active==true)
      restartMineService();

    return
}


// Receive mined blocks from other nodes
app.post('/ReceiveMinedBlock',(req,res) =>{
  // Initialize the transactions from the request
  var transactions = []
  for (var i=0; i<req.body.block.transactions.length;i++){
    var trans = req.body.block.transactions[i];
    var tmp = new Transaction()
    tmp = Object.assign(tmp, trans)
    transactions.push(tmp)
  }

  new_block = new Block(req.body.block.index, req.body.block.timestamp, transactions, req.body.block.prevHash, req.body.block.hash, req.body.block.nonce)
  // console.log(new_block)
  client.bc.chain.push(new_block);

  if(!client.bc.IsChainValid()){
    client.bc.chain.pop();
    console.log("Block invalid with id" + new_block.index + " received from " + req.ip)
    res.send("Block invalid with id" + new_block.index + " received from " + req.ip)
  }
  else{
    console.log("Block with id" + new_block.index + " received from " + req.ip)
    res.send("Block with id" + new_block.index + " received from " + req.ip)
    // If mining, update and restart
    if (miningWorker_active==true){
      restartMineService();
    }

  }
})


// Mining
var miningWorker;
var miningWorker_active = false;

app.get('/StartMine', function(req,res) {
  startMineService()
  console.log("Mining Started")
  res.json("Mining Started")
  return;
})

app.get('/StopMine', function(req,res) {
  stopMineService()
  console.log("Mining Stopped")
  res.json("Mining Stopped")
})

// Initialize and start the mining service
function startMineService(){
  mineService({"bc":client.bc, "publicKey":client.publicKey})
  miningWorker_active = true;
}
function stopMineService(){
  try{
    miningWorker.terminate();
  } catch (Exception){}
  miningWorker_active = false;
}
function restartMineService(){
  stopMineService();
  startMineService();
}

const mineService = (WorkerData) => {
  return new Promise((resolve, reject) => {
    miningWorker = new Worker("./mineWorker.js", {workerData:WorkerData});
    //Listen for a message from worker
    miningWorker.on("message", result => {
      // If the workers sends a message, it mined, so show the block and distribute on the network
      console.log("Mined a block")
      block = new Block()
      block = Object.assign(block, result["mined"])
      // Update the block on current instance and remove the added transactions
      client.bc.chain.push(block)
      for (var i=0; i<block.transactions.length;i++){
        var list = []
        var trans = block.transactions[i];
        var tmp = new Transaction()
        tmp = Object.assign(tmp, trans)
        for (var j=0; j<client.bc.pendingTransactions.length;j++){
          if(!tmp.equal(client.bc.pendingTransactions[j]))
            list.push(client.bc.pendingTransactions[j])
        }
        client.bc.pendingTransactions = list
      }
      // Distribute the block
      for(var i=0; i<networkList.length; i++){
        var peer = networkList[i];
        axios.post(peer+"/ReceiveMinedBlock",{"block":block}).then((res) => {}, (error) => {});
      }
    });
    miningWorker.on("error", error => {console.log(error);});
    miningWorker.on("exit", exitCode => {console.log(exitCode);})
    // Signal the worker to start miniong
    miningWorker.postMessage("startMine");
  })
}


// For debugging adds a block to the chain !!!!! DE STERS !!!!!!
// eg data: {"block":{"index":1,"nonce":4324,"transactions":[],"prevHash":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","hash":"","timestamp":"02/01/2022"}}
app.post('/sendBlock',(req,res) => {
  
  client.bc.VerifyAndPushMinedBlock(new Block(req.body.block.index,req.body.block.timestamp,req.body.block.transactions,req.body.block.prevHash,req.body.block.hash,req.body.block.nonce))

  console.log(client.bc.chain)
  res.send("Block Accepted")
 })


function IsEmpty(ob){
  for(var i in ob){ return false;}
    return true;
}