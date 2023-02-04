# Scratch-RPC Specification (v1.0)

This specification should provide the developer with the information needed to implement the protocol.

## 1 Overview

Scratch-RPC is a lightweight remote procedure call (RPC) protocol. It runs over a [WebSocket][1] connection and uses [MessagePack][2] for serialization.

## 2 Conventions

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [RFC 2119][3].

Since Scratch-RPC utilizes MessagePack, it has the same type system. MessagePack defines eight types (Nil, Boolean, Integer, Float, String, Binary, Array, and Map), but also allows up to 128 "Extension" types to be defined. Scratch-RPC defines exactly two Extension types, "Stream" and "Error". Whenever this document refers to any of these ten types, the first letter is always capitalized. True and False are also capitalized.

All member names exchanged between the Client and the Server that are considered for matching of any kind should be considered to be case-sensitive. The terms function, method, and procedure can be assumed to be interchangeable.

The Client is defined as the initiator of the WebSocket connection, the origin of Requests, and the handler of Responses.
The Server is defined as the acceptor of the WebSocket connection, the origin of Responses, and the handler of Requests.
A Peer is either a Client or a Server.

## 3 Stream

It's useful to be able to send octet streams of unknown length. It's particularly useful when large amounts of data can be sent in small pieces that can be processed on-the-fly, to reduce memory consumption. Also, it's useful for "publish-subscribe" mechanisms to have the concept of a data channel which has a beginning and (potentially) an end. With these goals in mind, Scratch-RPC defines the Stream extension type for MessagePack.

The Stream extension type MUST be assigned to the extension type "0". Serializers MUST encode it as a "fixext 8" with the following byte layout:

- Bytes 1-4 contain a Stream ID.
- Byte 5 is "1" if the Stream is an Octet Stream, or "0" otherwise.
- Bytes 6-8 are all "0".

Each Stream is coupled with a Stream ID which is unique among all Streams sent by the same Peer through the same WebSocket connection, throughout the entire lifespan of the WebSocket connection. The Stream ID is a 32-bit, big-endian, unsigned integer.

If a Stream is an Octet Stream (controlled by byte 5), it can only represents octets. Otherwise, it can represent any values within the Scratch-RPC type system.

When a Peer receives a Stream, they SHOULD store its associated Stream ID within a set of "open Stream IDs". This set MUST NOT be shared across the Peer's WebSocket connections, if more than one connection exists.

Deserializers MUST ignore the seven unused bits of byte 5 and bytes 6-8. That space is reserved for future versions of this specification.

### 3.1 Stream Chunk message

After a Peer sends a Stream, it SHOULD send one or more associated Stream Chunk messages across the same WebSocket connection. Stream Chunks provide the actual data represented by the Stream.

If no error has occurred in generating the data to be streamed, the Stream Chunk is serialized as an Array with these four elements:

- The first element is an Integer whose value is "0".
- The second element is True for the last Stream Chunk of a Stream, and False otherwise.
- The third element is an Integer whose value is the associated Stream ID.
- The fourth element is any value: the actual data represented by the Stream. If the associated Stream is an Octet Stream, this element MUST be Binary.

If an error *has* occured in generating the data to be streamed, a Stream Chunk MUST be sent, serialized as an Array with these three elements:

- The first element is an Integer whose value is "1".
- The second element is an Integer whose value is the associated Stream ID.
- The third element is an Error.

A Final Stream Chunk is a Stream Chunk that satisfies one of the following conditions:

- It contains "0" as its first element and True as its second element.
- It contains "1" as its first element.

A Peer MUST NOT send Stream Chunks associated with a Stream ID that was not previously sent across the same WebSocket connection. After a Peer sends a Final Stream Chunk, it MUST NOT ever send any more Stream Chunks with the same Stream ID across the same WebSocket connection.

If a Peer receives a Final Stream Chunk, it MUST remove its associated Stream ID from the set of "open Stream IDs". If a Peer receives a Stream Chunk whose Stream ID is not within the set of "open Stream IDs", it MUST ignore it. If a Peer receives a Stream Chunk whose first element is "0" and whose fourth element is not Binary, but whose associated Stream is an Octet Stream, it SHOULD close the WebSocket connection with a status code of "1008".

If a Stream is *not* an Octet Stream, the user which reads the Stream contents MUST receive each value exactly as they were sent in each Stream Chunk. However, Octet Streams are more lenient: the user MAY receive the Stream's octets in slices that differ from the slices that were delivered by the Stream Chunks, as long as the total concatenation of all slices remains unchanged.

### 3.2 Stream Cancel message

Users SHOULD have the ability to "cancel" a Stream that they received. If a user decides to cancel such a Stream, its Stream ID MUST immediately be removed from the set of "open Stream IDs".

Also, if (and only if) the cancelled Stream ID was actually in the set of "open Stream IDs", the cancelling Peer MUST immediately send a Stream Cancel message serialized as an Array of these two elements:

- The first element is an Integer whose value is "2".
- The second element is an Integer whose value is the associated Stream ID.

Attempting to cancel a Stream more than once, or attempting to cancel a Stream after already receiving an associated Final Stream Chunk, naturally results in a no-op. In such cases, a Stream Cancel SHOULD NOT be sent.

After a Peer receives a Stream Cancel, it SHOULD NOT ever send any more Stream Chunks with the same Stream ID across the same WebSocket connection. If a Peer receives a Stream Cancel containing a Stream ID that it does not recognize, it MUST ignore it.

## 4 Error

It's useful to have a consistent way of representing application errors. To that end, Scratch-RPC defines the Error extension type for MessagePack.

The Error extension type MUST be assigned to the extension type "1". Serializers MUST encode its "data segment" as a Map with at least one String key called "message" whose value is a String. The Map MAY have other key-value pairs.

## 5 Request message

An RPC call is represented by sending a Request message from the Client to the Server, across the WebSocket connection.

A Request is serialized as an Array with these four elements:

- The first element is an Integer whose value is "3".
- The second element is the associated Request ID (see below).
- The third element is a String whose value is the name of the requested method.
- The fourth element is any value within the Scratch-RPC type system, representing the "parameter" being passed to the method call.

Each Request is coupled with a Request ID. The Request ID is either Nil *or* an Integer containing an unsigned 32-bit value. Request IDs that are not Nil MUST be unique among all Requests sent by the same Client through the same WebSocket connection, throughout the entire lifespan of the WebSocket connection.

When a Client sends a Request with a non-Nil Request ID, they MUST store the Request ID within a set of "open Request IDs". This set MUST NOT be shared across the Client's WebSocket connections, if more than one connection exists.

When a Server receives a Request with a non-Nil Request ID, it MUST send back a Response message containing the same Request ID.

If a Client receives a Request, it SHOULD close the WebSocket connection with a status code of "1008".

### 5.1 Notification message

A Request with a Nil Request Id is called a Notification. Notifications are used to invoke methods without expecting a response. This is useful for simulating unidirectional "events". Servers MAY change their behavior depending on whether a method was invoked as a Notification or not. For example, if a Server knows it doesn't need to generate a response, it may avoid some expensive operations.

A Server MUST NOT send a Response in reply to a Notification.

## 6 Response message

When an RPC call is made, the Server MUST reply by sending a Response, unless the call was a Notification.

If the method handler was successful, the Response is serialized as an Array with these three elements:

- The first element is an Integer whose value is "4".
- The second element is the associated Request ID.
- The third element is any value within the Scratch-RPC type system, representing the "return value" of the method call.

If the method handler was *not* successful (i.e., it encountered an error), *or* the requested method is not implemented, the Response is serialized as an Array with these three elements:

- The first element is an Integer whose value is "5".
- The second element is the associated Request ID.
- The third element is an Error.

It is RECOMMENDED that implementations provide programmers with the ability to customize the Error, even in cases where the requested method was not implemented.

If a Client receives a Response, it MUST remove its associated Request ID from the set of "open Request IDs". If a Client receives a Response whose Request ID is not within the set of "open Request IDs", it MUST ignore it.

If a Server receives a Response, it SHOULD close the WebSocket connection with a status code of "1008".

### 6.1 Response Cancel message

Clients SHOULD have the ability to "cancel" an RPC call that they initiated. If a Client decides to cancel an RPC call, its Request ID MUST immediately be removed from the set of "open Request IDs".

Also, if (and only if) the cancelled Request ID was actually in the set of "open Request IDs", the Client MUST immediately send a Response Cancel message serialized as an Array of these two elements:

- The first element is an Integer whose value is "6".
- The second element is an Integer whose value is the associated Request ID.

Attempting to cancel an RPC call more than once, or attempting to cancel after already receiving an associated Response, naturally results in a no-op. In such cases, a Response Cancel SHOULD NOT be sent.

After a Server receives a Response Cancel, it SHOULD NOT ever send a Response with the same Request ID across the same WebSocket connection. If a Server receives a Response Cancel containing a Request ID that it does not recognize, it MUST ignore it.

If a Client receives a Response Cancel, it SHOULD close the WebSocket connection with a status code of "1008".

## 7 WebSocket handling

A Scratch-RPC connection inherits the same lifecycle as the underlying WebSocket connection. Therefore, a Scratch-RPC connection is established the moment a WebSocket connection is successfully established, and a Scratch-RPC connection is considered "closed" the moment its underlying WebSocket connection is considered "closed".

All messages sent across the WebSocket connection MUST be sent in binary frames. If a Peer receives a text frame, it SHOULD close the WebSocket connection with a status code of "1003".

### 7.1 WebSocket compresion

It is RECOMMENDED for Scratch-RPC Server and Client implementations to support the [permessage-deflate][4] WebSocket extension. It is RECOMMENDED that this extension is enabled by default, with default extension parameters that are appropriate for the implementation's use-cases.

### 7.2 WebSocket payload limits

Implementations SHOULD configure two variables for controlling payload limits on the Scratch-RPC connection (whether or not these variables are configurable by the user is OPTIONAL):

- MAX_PAYLOAD (RECOMMENDED default is 1 GiB)
- MAX_BUFFERED_PAYLOAD (RECOMMENDED default is 1 MiB)

MAX_PAYLOAD defines the maximum size of a Request or Response, including streams, while MAX_BUFFERED_PAYLOAD defines the maximum size of a Request or Response, *excluding* streams.

If a Peer receives a message that violates one of these limits, it SHOULD close the WebSocket connection with a status code of "1009".

### 7.3 WebSocket timeouts and heartbeats

Scratch-RPC defines a heartbeat mechanism for automatically closing hanging connections. Implementations MUST configure three variables for controlling these timeouts (whether or not these variables are configurable by the user is OPTIONAL):

- HANDSHAKE_TIMEOUT (RECOMMENDED default is 20 seconds)
- HEARTBEAT_INTERVAL (RECOMMENDED default is 5 seconds)
- HEARTBEAT_TRIES (RECOMMENDED default is 3)

If a WebSocket connection cannot be established within {HANDSHAKE_TIMEOUT} seconds, the Client MUST abort the connection attempt.

Upon establishing a WebSocket connection, each Peer MUST execute the `WaitForActivity` routine, shown below, to initiate Scratch-RPC's heartbeat mechanism. Upon receiving any message, WebSocket "ping" frame, *or* WebSocket "pong" frame, the Peer MUST re-execute the `WaitForActivity` routine.

```
DEFINE WaitForActivity:
	StopTimer(timer)
	pingCount = 0
	timer = StartTimer(NoActivity, {HEARTBEAT_INTERVAL})

DEFINE NoActivity:
	pingCount = pingCount + 1
	IF pingCount > {HEARTBEAT_TRIES}:
		Terminate()
	ELSE:
		IF WebSocket is in the "OPEN" state:
			Send a WebSocket "ping" frame
		timer = StartTimer(NoActivity, {HEARTBEAT_INTERVAL})

DEFINE Terminate:
	Send a WebSocket "close" frame with status code "1001"
	Forcefully destroy the underlying connection
	RECOMMENDED:
		Raise a timeout exception containing status code "1006"
```

Whenever a Peer receives a WebSocket "ping" frame, it MUST immediately reply with a WebSocket "pong" frame.

Implementations SHOULD ensure that all relevant timers are cleaned up when a WebSocket connection closes for any reason.

### 7.4 WebSocket connection closure

If a Peer closes a Scratch-RPC connection without error, they SHOULD use the status code "1000" or "1001".

If a Peer receives a message that does not adhere to the serializations defined by this specification, it SHOULD close the WebSocket connection with a status code of "1008". However, if a message Array has more elements than the number defined by this specification, the additional elements MUST be ignored. Such additional elements are reserved for future versions of this specification. Similarly, if a Peer receives a message that is an Array whose first element is an Integer equal to "8", it MUST be ignored. If a Peer receives a MessagePack type that is not recognized by this specification, it is RECOMMENDED to close the WebSocket connection with a status code of "1008", but it MAY instead choose some implementation-specific or application-specific handling.



[1]: https://www.rfc-editor.org/rfc/rfc6455
[2]: https://github.com/msgpack/msgpack/blob/master/spec.md
[3]: https://www.ietf.org/rfc/rfc2119.txt
[4]: https://www.rfc-editor.org/rfc/rfc7692#section-7
