# blue-rpc-protocol

BlueRPC is a *fast* RPC protocol that uses [WebSockets](https://www.rfc-editor.org/rfc/rfc6455) and [MessagePack](https://msgpack.org/index.html). It solves real-world problems and is very easy to use.

In BlueRPC, streams are first-class data types. You can send streams just like *any* other value, and BlueRPC automatically handles things like cancellation and [backpressure](https://nodejs.org/en/docs/guides/backpressuring-in-streams/).

> Since streams are just regular values, you can easily mix them with structured data, unlike HTTP (where you'd need to use headers or "multipart/form-data" for structured data) or [gRPC](https://grpc.io/) (where there's no way to directly represent a byte stream) or [JSON-RPC](https://www.jsonrpc.org/specification) (which doesn't support streaming at all).

Here are its features:

- Byte streams, good for efficiently piping **large payloads** such as files.
- Object streams, good for representing **pub-sub** subscriptions or observables.
- Universal web-compatibility, because of [WebSockets](https://www.rfc-editor.org/rfc/rfc6455).
- Low bandwidth, because of [MessagePack](https://msgpack.org/index.html), [WebSockets](https://www.rfc-editor.org/rfc/rfc6455), and [automatic compression](https://www.rfc-editor.org/rfc/rfc7692#section-7).
- Simple RPC-style interface.
- Built-in support for **cancelling** RPC calls and streams.
- "Notifications", inspired by [JSON-RPC](https://www.jsonrpc.org/specification), for pushing lightweight events to the server.
- Encodes strings, binary ([Buffer](https://nodejs.org/api/buffer.html) or [Uint8Array](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array)), objects, arrays, floats, integers ([BigInt](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt)), booleans, null, [Error](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error), and streams ([stream.Readable](https://nodejs.org/api/stream.html#class-streamreadable) or [ReadableStream](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream)).

BlueRPC can be implemented in any general-purpose programming language. This repository contains a [specification](./docs/spec.md) and a reference implementation for JavaScript (compatible with Node.js and browsers).

## Installation

```
npm install blue-rpc-protocol
```

> Requires Node.js v16.x.x or later, or any modern browser.

## Usage

#### Server example

```js
const http = require('http');
const BlueRPC = require('blue-rpc-protocol');

const methods = {
    echo: (param) => {
        return param;
    }
};

await BlueRPC.listen({
    methods,
    server: http.createServer(),
    logger: console.log
});
```

#### Client example

```js
const BlueRPC = require('blue-rpc-protocol');

const client = BlueRPC.createClient('ws://localhost');

const result = await client.invoke('echo', 'foo');
console.log('result:', result); // => "result: foo"
```

## Documentation

- [API documentation](./docs/api.md)
- [Specification](./docs/spec.md)

## License

[MIT](./LICENSE)
