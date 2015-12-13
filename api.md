## Members

<dl>
<dt><a href="#http">http</a></dt>
<dd><p>Module dependencies.</p>
</dd>
</dl>

## Functions

<dl>
<dt><a href="#Symple">Symple(optional,)</a></dt>
<dd><p>Symple server class.</p>
<p>TODO: verify loaded session data</p>
</dd>
</dl>

<a name="http"></a>
## http
Module dependencies.

**Kind**: global variable  
<a name="Symple"></a>
## Symple(optional,)
Symple server class.

TODO: verify loaded session data

**Kind**: global function  
**Api**: public  

| Param | Type | Description |
| --- | --- | --- |
| optional, | <code>Object</code> | config object |


* [Symple(optional,)](#Symple)
    * [.loadConfig(absolute)](#Symple+loadConfig)
    * [.init()](#Symple+init)
    * [.shutdown()](#Symple+shutdown)
    * [.parseAddress(address)](#Symple+parseAddress)

<a name="Symple+loadConfig"></a>
### symple.loadConfig(absolute)
Load configuration from a file.

**Kind**: instance method of <code>[Symple](#Symple)</code>  
**Api**: public  

| Param | Type | Description |
| --- | --- | --- |
| absolute | <code>String</code> | file path |

<a name="Symple+init"></a>
### symple.init()
Initialize the Symple server.

**Kind**: instance method of <code>[Symple](#Symple)</code>  
**Api**: public  
<a name="Symple+shutdown"></a>
### symple.shutdown()
Shutdown the Symple server.

**Kind**: instance method of <code>[Symple](#Symple)</code>  
**Api**: public  
<a name="Symple+parseAddress"></a>
### symple.parseAddress(address)
Parse a Symple endpoint address with the format: user@group/id

**Kind**: instance method of <code>[Symple](#Symple)</code>  
**Api**: public  

| Param | Type | Description |
| --- | --- | --- |
| address | <code>Object</code> | string |

