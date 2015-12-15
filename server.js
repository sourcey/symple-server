// include Symple
var Symple = require('./lib/symple');

// instantiate the Symple server
var sy = new Symple();

// load a config file
sy.loadConfig(__dirname + "/config.json");

// initialize the server
sy.init();

// access socket.io instance methods if required
// sy.io.use(function(socket, next) { });

// access HTTP/S server instance methods if required
// sy.http.use(function(socket, next) { });

console.log('Symple server listening on port ' + sy.config.port);
