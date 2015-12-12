# Symple Node.js Server

The Symple server is a real time messaging server built on top of `socket.io` and `redis` for creating blazing fast messaging applications such as chat, media streaming, and games that run in the web browser, desktop, and mobile phone.

Symple is a unrestrictive real time messaging and presence protocol that implements the minimum number of features required to build full fledged messaging applications with security, flexibility, performance and scalability in mind. These features include:

* Session sharing (using Redis)
* User rostering and presence
* Media streaming (WebRTC)
* Real-time forms

## Installation

```bash
npm install symple
```

## Usage

To get started straight away fire up the server by typing `node server`

The `server.js` file in the root directory of the repo provides a code example of how to include and extend the Symple server:


```bash
// Include Symple
var symple = require('./symple');

// Instantiate the Symple server
var sy = new symple();

// Load a config file
sy.loadConfig(__dirname + "/config.json");

// Initialize the server
sy.init();

// Access Socket.IO functions if required
// sy.io.use(function(socket, next) { });
```

See the [configuration options](#configuration) below for a list of available options.

Once the server is up and running you need a client to connect to it. There are a few options here:

* [JavaScript](https://github.com/sourcey/symple-client)
* [Ruby](https://github.com/sourcey/symple-client-ruby) 
* [C++](https://github.com/sourcey/libsourcey/tree/master/src/symple)

## Configuration

The configure the server modify `config.json` as you see fit.

```
{
  /* The port to listen on */
  "port" : 4500,  
  
  /* Allow anonymous connections */
  "anonymous" : false,  
    
  /* Redis configuration (required if anonymous == false) */
  "redis" : {
    "host" : "127.0.0.1",
    "port" : 6379,
    "password" : ""
  },
  
  /* SSL configuration (required if using HTTPS) */
  "ssl" : {
    "enabled" : false,
    "key" : "/path/to/.key",
    "cert" : "/path/to/.crt"
  }
}
```

## Contributing

1. Fork it
2. Create your feature branch (`git checkout -b my-new-feature`)
3. Commit your changes (`git commit -am 'Add some feature'`)
4. Push to the branch (`git push origin my-new-feature`)
5. Create new Pull Request

## Contact

For more information please check out the Symple homepage: http://sourcey.com/symple/  
For bug or issues please use our the Github issue tracker: https://github.com/sourcey/symple-server-node/issues
