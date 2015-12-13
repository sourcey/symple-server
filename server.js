// Include Symple
var symple = require('./src/symple');

// Instantiate the Symple server
var sy = new symple();

// Load a config file
sy.loadConfig(__dirname + "/config.json");

// Initialize the server
sy.init();

// Access Socket.IO functions if required
// sy.io.use(function(socket, next) { });

console.log('Symple server listening on port ' + sy.config.port);
