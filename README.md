# Symple Node.js Server

The Symple Node.js server is a server-side module which connects clients and routes real-time messages using the Symple protocol. 

## What is Symple?

Symple is a unrestrictive real-time messaging and presence protocol. 

The protocol itself is semantically similar to XMPP, except that it is much more flexible and economical due to the use of JSON instead of XML for encoding messages. 

Symple currently has client implementations in [JavaScript](https://github.com/sourcey/symple-client), [Ruby](https://github.com/sourcey/symple-client-ruby) and [C++](https://github.com/sourcey/libsourcey/tree/master/src/symple), which make it ideal for a wide range of messaging requirements, such as building real-time games and applications which run in the web browser, desktop, and mobile phone.

## How to use it

1. Clone the `symple-server` repository.
2. Copy `config.json.default` to `config.json` and edit as required. See [configuration options](#configuration-options) below.
3. Fire up the Node.js server `node server`
4. Check out the `symple-client` or other client repositories to start building your client application.

## Configuration options

```
{
  /* The ID of the node instance */
  "nodeId" : 1,
  
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
If you have a bug or an issue then please use our new Github issue tracker: https://github.com/sourcey/symple-server-node/issues
