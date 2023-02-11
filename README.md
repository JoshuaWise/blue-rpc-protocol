# blue-rpc

BlueRPC is a simple but **powerful** RPC protocol that uses [WebSockets](https://www.rfc-editor.org/rfc/rfc6455) and [MessagePack](https://msgpack.org/index.html). It gives you features that solve common real-world problems, and is very easy to use.

In BlueRPC, streams are first-class citizens. You can send streams just like *any* other data type, and BlueRPC automatically handles things like cancellation and [backpressure](https://nodejs.org/en/docs/guides/backpressuring-in-streams/).

Here are its features:

- First-class byte streams, useful for efficiently piping **large payloads** such as files.
- First-class value streams, useful for representing **pub-sub** subscriptions and observables.
- Universal web-compatibility, thanks to [WebSockets](https://www.rfc-editor.org/rfc/rfc6455).
- Low bandwidth, thanks to [MessagePack](https://msgpack.org/index.html), [WebSockets](https://www.rfc-editor.org/rfc/rfc6455), and [automatic compression](https://www.rfc-editor.org/rfc/rfc7692#section-7).
- Built-in support for **cancelling** RPC calls and streams.
- "Notifications", inspired by [JSON-RPC](https://www.jsonrpc.org/specification), for pushing lightweight events to the server.
- Simple RPC-style interface.
- Encodes strings, binary ([Buffer](https://nodejs.org/api/buffer.html) or [Uint8Array](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array)), objects, arrays, floats, integers ([BigInt](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt)), booleans, null, [Error](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error), and streams ([stream.Readable](https://nodejs.org/api/stream.html#class-streamreadable) or [ReadableStream](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream)).

BlueRPC can be implemented in any general-purpose programming language. This repository contains a [specification](./docs/spec.md) and a reference implementation for JavaScript (compatible with Node.js and browsers).

## Installation

```
npm install blue-rpc
```

> Requires Node.js v14.21.2 or later, or any modern browser.

## Usage

#### Server example

```js
const http = require('http');
const BlueRPC = require('blue-rpc');

const methods = {
    echo: (param) => {
        return param;
    }
};

await BlueRPC.listen({
	methods,
	server: http.createServer(),
	logger: console.log,
});
```

#### Client example

```js
const BlueRPC = require('blue-rpc');

const client = BlueRPC.createClient('ws://localhost');
const result = await client.invoke('echo', 'foo');

console.log('result:', result); // => "result: foo"
```

## Documentation

- [API documentation](./docs/api.md)
- [Specification](./docs/spec.md)

## License

[MIT](./LICENSE)
