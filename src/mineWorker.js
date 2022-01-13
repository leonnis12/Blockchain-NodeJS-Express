const { parentPort, workerData } = require('worker_threads');
const {Transaction, BlockChain, Block} = require('./Blockchain')

//   Setup from the worker data
class Client{
    constructor(){
      this.bc = new BlockChain();
    }
  }
let client = new Client()
client.bc = new BlockChain()
client.bc = Object.assign(client.bc, workerData["bc"])
client.publicKey = workerData["publicKey"]


// Message listener
parentPort.on("message", async message => {
    if (message === "exit") {
      parentPort.close();
    } else if(message==="startMine"){
        while(true){
            block = client.bc.MinePendingTransaction(client.publicKey);
            // Transmit back the mined block
            parentPort.postMessage({"mined": block});
        }
    } else {
      parentPort.postMessage({ going: message });
    }
  });

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}