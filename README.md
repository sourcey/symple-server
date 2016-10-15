# Symple Server

The Symple Node.js server is a real time messaging server built on top of `socket.io` and `redis` for creating blazing fast messaging applications quickly and easily. Use cases include chat, sms, media streaming, and games that run in the web browser, desktop, or on mobile devices.

## What is Symple?

Symple is a unrestrictive real time messaging and presence protocol that implements the minimum number of features required to build full fledged messaging applications with security, flexibility, performance and scalability in mind. These features include:

* Session sharing with any backend (via Redis)
* User rostering and presence
* Media streaming (via WebRTC, [see demo](http://symple.sourcey.com))
* Scoped messaging ie. direct, user and group scope
* Real-time commands and events
* Real-time forms

## Installation

[Install Redis](http://redis.io/download) Note that Redis is optional, but required if you want to share secure sessions. If you're using Ubuntu just type:

```
sudo apt-get install redis-server
```

Install Symple from npm:

```bash
npm install symple

# use the --save flag to automatically add Symple to your package.json dependencies
# npm install symple --save
```

Done.

## Usage

To get started straight away fire up the default server by typing:

```bash
node server

# or using npm
# npm start
```

The `server.js` file in the root directory of the repo provides an example of how to include the Symple server in your own code:

```bash
// include Symple
var Symple = require('symple');

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
```

See the [configuration options](#configuration) below for a list of available options.

Once the server is up and running you need a client to connect to it. There are a number of options here in the following languages:

* JavaScript: https://github.com/sourcey/symple-client
* Ruby: https://github.com/sourcey/symple-client-ruby
* C++: https://github.com/sourcey/libsourcey/tree/master/src/symple

## Configuration

To configure the server just modify `symple.json` as needed:

```
{
  /*
    The port to listen on (default: 4500).
    If `process.env.PORT` is set, the env value will be used instead.
    Port 443 should always be used for SSL.
  */
  "port" : 4500,  /* 443 */

  /*
    Session time-to-live in minutes (default: 15 minutes)
    This is the duration of time before sessions expire after the client disconnects.
    If set to `-1` the session will never expire.
  */
  "sessionTTL" : 15,

  /* Enable or disable authentication */
  "authentication" : true,

  /*
    Redis configuration
    Redis must be available if using `authentication = true`
  */
  "redis" : {
    "host" : "localhost",
    "port" : 6379,
    "password" : "redispwd"
  },

  /* SSL configuration */
  "ssl" : {
    "enabled" : false,
    "key" : "ssl/symple.key",
    "cert" : "ssl/symple.crt"
  }
}
```

## API Reference

<a name="Symple"></a>
## Symple
Symple server class.

**Kind**: global class  
**Access:** public  

* [Symple](#Symple)
    * [new Symple(config)](#new_Symple_new)
    * [.loadConfig(filepath)](#Symple+loadConfig)
    * [.init()](#Symple+init)
    * [.shutdown()](#Symple+shutdown)
    * [.broadcast(socket, message)](#Symple+broadcast)
    * [.getSession(token, fn)](#Symple+getSession)
    * [.touchSession(token, fn)](#Symple+touchSession)
    * [.parseAddress(str)](#Symple+parseAddress)

<a name="new_Symple_new"></a>
### new Symple(config)

| Param | Type | Description |
| --- | --- | --- |
| config | <code>Object</code> | optional confguration object (see config.json) |
| config.port | <code>string</code> | the port to listen on |
| config.redis | <code>Object</code> | redis configuration |
| config.ssl | <code>Object</code> | ssl configuration |
| config.sessionTTL | <code>number</code> | session timeout value |
| config.authentication | <code>boolean</code> | enable/disable authentication |

<a name="Symple+loadConfig"></a>
### symple.loadConfig(filepath)
Load configuration from a file.

**Kind**: instance method of <code>[Symple](#Symple)</code>  
**Access:** public  

| Param | Type | Description |
| --- | --- | --- |
| filepath | <code>string</code> | absolute path to config.json |

<a name="Symple+init"></a>
### symple.init()
Initialize the Symple server.

**Kind**: instance method of <code>[Symple](#Symple)</code>  
**Access:** public  
<a name="Symple+shutdown"></a>
### symple.shutdown()
Shutdown the Symple server.

**Kind**: instance method of <code>[Symple](#Symple)</code>  
**Access:** public  
<a name="Symple+broadcast"></a>
### symple.broadcast(socket, message)
Broadcast a message over the given socket.

**Kind**: instance method of <code>[Symple](#Symple)</code>  
**Access:** public  

| Param | Type | Description |
| --- | --- | --- |
| socket | <code>Socket</code> | client socket |
| message | <code>Object</code> | message to send |

<a name="Symple+getSession"></a>
### symple.getSession(token, fn)
Get a peer session by it's token.

**Kind**: instance method of <code>[Symple](#Symple)</code>  
**Access:** public  

| Param | Type | Description |
| --- | --- | --- |
| token | <code>Object</code> | address string |
| fn | <code>function</code> | callback function |

<a name="Symple+touchSession"></a>
### symple.touchSession(token, fn)
Touch a peer session by it's token and extend
it's lifetime by (config.sessionTTL) minutes.

**Kind**: instance method of <code>[Symple](#Symple)</code>  
**Access:** public  

| Param | Type | Description |
| --- | --- | --- |
| token | <code>Object</code> | address string |
| fn | <code>function</code> | callback function |

<a name="Symple+parseAddress"></a>
### symple.parseAddress(str)
Parse a peer address with the format: user@group/id

**Kind**: instance method of <code>[Symple](#Symple)</code>  
**Access:** public  

| Param | Type | Description |
| --- | --- | --- |
| str | <code>Object</code> | address string |


## Contributing

Contributions are always welcome :)

1. Fork it
2. Create your feature branch (`git checkout -b my-new-feature`)
3. Commit your changes (`git commit -am 'Add some feature'`)
4. Push to the branch (`git push origin my-new-feature`)
5. Create new Pull Request

## Contact

For more information check out the Symple homepage: http://sourcey.com/symple/
For bugs or issues please use the Github issue tracker: https://github.com/sourcey/symple-server-node/issues
