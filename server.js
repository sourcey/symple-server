// include Symple
var Symple = require('./lib/symple');

// instantiate the Symple server
var sy = new Symple();

// load a config file
sy.loadConfig(__dirname + "/symple.json");

// initialize the server
sy.init();

// access socket.io instance methods if required
// sy.io.use(function(socket, next) { });

// access HTTP/S server instance methods if required
// sy.http ...

// access Redis publish/subscribe client instance methods
// sy.pub ...
// sy.sub ...

console.log('Symple server listening on port ' + sy.config.port);
