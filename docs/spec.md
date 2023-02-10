# BlueRPC Specification (v1.0)

This specification should provide the developer with the information needed to implement the protocol.

## 1 Overview

BlueRPC is a lightweight remote procedure call (RPC) protocol. It runs over a [WebSocket][1] connection and uses [MessagePack][2] for serialization.

## 2 Conventions

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [RFC 2119][3].

Since BlueRPC utilizes MessagePack, it has the same type system. MessagePack defines eight types (Nil, Boolean, Integer, Float, String, Binary, Array, and Map), but also allows up to 128 "Extension" types to be defined. BlueRPC defines exactly two Extension types, "Stream" and "Error". Whenever this document refers to any of these ten types, the first letter is always capitalized. True and False are also capitalized.

This specification defines the semantics for using BlueRPC to operate over a single WebSocket connection. All variables and data structures defined therein are specific to the scope of a single WebSocket connection.

All member names exchanged between the Client and the Server that are considered for matching of any kind should be considered to be case-sensitive. The terms function, method, and procedure can be assumed to be interchangeable.

The Client is defined as the initiator of the WebSocket connection, the origin of Requests, and the handler of Responses.
The Server is defined as the acceptor of the WebSocket connection, the origin of Responses, and the handler of Requests.
A Peer is either a Client or a Server.

## 3 Message framing

BlueRPC works by sending WebSocket messages between Peers. Some messages represent RPC requests and responses, while others are used for internal mechanisms such as handling streams.

Every message in BlueRPC is serialized as an Array with a fixed number of elements. The first element is always an Integer, identifying the type of the message. The remaining elements depend on the message type.

If a Peer receives a message that is not an Array, or otherwise does not adhere to the serializations defined by this specification, it SHOULD close the WebSocket connection with a status code of "1008". For example, if a Peer receives a message Array with a different number of elements than defined by this specification, it SHOULD close the WebSocket connection with a status code of "1008". Likewise, if a Peer receives a message that is an Array whose first element is not an Integer, it SHOULD close the WebSocket connection with a status code of "1008".

If a Peer receives a message that is an Array whose first element is an Integer with a value of "10" or any negative number, it SHOULD close the WebSocket connection with a status code of "1008". Otherwise, if a Peer receives a message that is an Array whose first element is an Integer not defined by this specification, it MUST be ignored; such messages are reserved for future versions of this specification.

Every message in BlueRPC MUST be sent in a WebSocket binary frame. If a Peer receives a text frame, it SHOULD close the WebSocket connection with a status code of "1003".

If a Peer receives a MessagePack type that is not recognized by this specification, it is RECOMMENDED to close the WebSocket connection with a status code of "1008", but it MAY instead choose some implementation-specific or application-specific handling.

## 4 Request message

An RPC call is represented by sending a Request message from the Client to the Server, across the WebSocket connection.

A Request is serialized as an Array with these four elements:

- The first element is an Integer whose value is "0".
- The second element is an Integer whose value is a Request ID (see below).
- The third element is a String whose value is the name of the requested method.
- The fourth element is any value within the BlueRPC type system, representing the "parameter" being passed to the method call.

Each Request is coupled with a Request ID. Request IDs MUST be unique among all Requests sent by the same Client through the same WebSocket connection, throughout the entire lifespan of the WebSocket connection. When a Client sends a Request, they MUST store its Request ID within a set of "open Request IDs".

When a Server receives a Request, it MUST reply with a Response message containing the same Request ID (except in the case of Notifications, discussed later). While the Server is handling the Request, it MUST store the associated Request ID within a set of "open Request IDs". If a Server receives a Request with a Request ID that is already in its set of "open Request IDs", it SHOULD close the WebSocket connection with a status code of "1008".

If a Client receives a Request, it SHOULD close the WebSocket connection with a status code of "1008".

### 4.1 Notification message

A Notification is a special kind of Request that has no Request ID. A Notification is serialized as an Array with these three elements:

- The first element is an Integer whose value is "1".
- The second element is a String whose value is the name of the requested method.
- The third element is any value within the BlueRPC type system, representing the "parameter" being passed to the method call.

Notifications are used to invoke methods without expecting a response. This is useful for simulating unidirectional "events". Servers MAY change their behavior depending on whether a method was invoked as a Notification or not. For example, if a Server knows it doesn't need to generate a response, it may avoid some expensive operations.

A Server MUST NOT send a Response in reply to a Notification.

## 5 Response message

When an RPC call is made, the Server MUST reply by sending a Response, unless the call was a Notification. When the Server sends a Response, it MUST remove the associated Request ID from its set of "open Request IDs".

If the method handler was successful, the Response is serialized as an Array with these three elements:

- The first element is an Integer whose value is "2".
- The second element is an Integer whose value is the associated Request ID.
- The third element is any value within the BlueRPC type system, representing the "return value" of the method call.

If the method handler was *not* successful (i.e., it encountered an error), *or* the requested method is not implemented, the Response is serialized as an Array with these three elements:

- The first element is an Integer whose value is "3".
- The second element is an Integer whose value is the associated Request ID.
- The third element is an Error.

It is RECOMMENDED that implementations provide programmers with the ability to customize the Error, even in cases where the requested method was not implemented. This specification does not define any standard "error codes"; it is up to the application developer to design errors that are appropriate for their application.

After a Server sends a Response, it is RECOMMENDED that implementations cancel any *unused* Streams that were sent in the associated Request (i.e., Streams which were received but not used in handling the method).

If a Client receives a Response, it MUST remove the associated Request ID from the set of "open Request IDs". If a Client receives a Response whose Request ID is not within the set of "open Request IDs", it MUST ignore it.

If a Server receives a Response, it SHOULD close the WebSocket connection with a status code of "1008".

## 6 Cancellation message

Clients SHOULD have the ability to "cancel" an RPC call that they initiated. If a Client decides to cancel an RPC call, its Request ID MUST immediately be removed from the set of "open Request IDs".

Also, if (and only if) the cancelled Request ID was actually in the set of "open Request IDs", the Client MUST immediately send a Cancellation message serialized as an Array of these two elements:

- The first element is an Integer whose value is "4".
- The second element is an Integer whose value is the associated Request ID.

Attempting to cancel an RPC call more than once, or attempting to cancel after already receiving an associated Response, naturally results in a no-op. In such cases, a Cancellation SHOULD NOT be sent.

After a Server receives a Cancellation, it SHOULD NOT ever send a Response with the same Request ID across the same WebSocket connection. When a Server receives a Cancellation, it MUST remove the associated Request ID from its set of "open Request IDs". If a Server receives a Cancellation containing a Request ID that is not within its set of "open Request IDs", it MUST ignore it.

When a Client cancels an RPC call, it is RECOMMENDED that implementations also cancel any Streams that were sent in the associated Request.

If a Client receives a Cancellation, it SHOULD close the WebSocket connection with a status code of "1008".

## 7 Stream

It's useful to be able to send octet streams of unknown length. It's particularly useful when large amounts of data can be sent in small pieces that can be processed on-the-fly, to reduce memory consumption. Also, it's useful for "publish-subscribe" mechanisms to have the concept of a data channel which has a beginning and (potentially) an end. With these goals in mind, BlueRPC defines the Stream extension type for MessagePack.

The Stream extension type MUST be assigned to the extension type "0". Serializers MUST encode it as a "fixext 8" with the following byte layout:

- Bytes 1-4 contain a Stream ID.
- Byte 5 is "1" if the Stream is an Octet Stream, or "0" otherwise.
- Bytes 6-8 are all "0".

Each Stream is coupled with a Stream ID which is unique among all Streams sent by the same Peer through the same WebSocket connection, throughout the entire lifespan of the WebSocket connection. The Stream ID is a 32-bit, big-endian, unsigned integer. After sending a WebSocket message containing a Stream, the Peer MUST NOT ever send a Stream with the same Stream ID through the same WebSocket connection, throughout the entire lifespan of the WebSocket connection. However, a single Stream MAY appear multiple times within the same WebSocket message, in which case each appearance SHOULD reference the same entity after deserialization. Note that a Stream which a Peer receives may have the same Stream ID as a Stream that the Peer has sent; there is no correlation between such Streams.

If a Stream is an Octet Stream (controlled by byte 5), it can only represent octets. Otherwise, it is an Object Stream and can represent any *non-Stream* values within the BlueRPC type system.

When a Peer sends a Stream, they MUST store its associated Stream ID within a set of "sent Stream IDs". When a Peer receives a Stream, they SHOULD store its associated Stream ID within a set of "received Stream IDs". If a Peer receives a Stream with a Stream ID that is already in its set of "received Stream IDs", it SHOULD close the WebSocket connection with a status code of "1008".

Deserializers MUST ignore bytes 6-8 and the seven unused bits of byte 5. That space is reserved for future versions of this specification.

### 7.1 Stream Chunk message

After a Peer sends a Stream, it SHOULD send one or more associated Stream Chunk messages across the same WebSocket connection. Stream Chunks provide the actual data represented by the Stream.

If no error has occurred in generating the data to be streamed, the Stream Chunk is serialized as an Array with these three elements:

- The first element is an Integer whose value is "5".
- The second element is an Integer whose value is the associated Stream ID.
- The third element, called the "Stream Data", is always Binary. For Octet Streams, it contains the actual octets represented by the Stream. For Object Streams, it contains any serialized value within the BlueRPC type system, but MUST NOT contain any Streams (even if nested within other values).

If no error has occurred but there is no more data to be streamed, a Stream Chunk MUST be sent, serialized as an Array with these two elements:

- The first element is an Integer whose value is "6".
- The second element is an Integer whose value is the associated Stream ID.

If an error *has* occured in generating the data to be streamed, a Stream Chunk MUST be sent, serialized as an Array with these three elements:

- The first element is an Integer whose value is "7".
- The second element is an Integer whose value is the associated Stream ID.
- The third element is an Error which MUST NOT contain any Streams (even if nested within other values).

A Peer MUST NOT send Stream Chunks associated with a Stream ID that is not within its set of "sent Stream IDs". A Stream Chunk whose first element is either "6" or "7" is called a Final Stream Chunk. After a Peer sends a Final Stream Chunk, it MUST remove the associated Stream ID from its set of "sent Stream IDs" and it MUST NOT ever send any more Stream Chunks with the same Stream ID across the same WebSocket connection.

If a Peer receives a Final Stream Chunk, it MUST remove its associated Stream ID from the set of "received Stream IDs". If a Peer receives a Stream Chunk whose Stream ID is not within the set of "received Stream IDs", it MUST ignore it. If a Peer receives a Stream Chunk that contains another Stream (either within Stream Data or within a Final Stream Chunk's Error), it SHOULD close the WebSocket connection with a status code of "1008".

A Stream MAY be "empty", which means it has no associated non-Final Stream Chunks. Independently, a Stream MAY be "endless", which means it has no associated Final Stream Chunk. However, implementations should take care to clean up all Streams, even endless ones, when the Stream is cancelled or when the WebSocket connection closes.

If a Stream is *not* an Octet Stream, the user which reads the Stream contents MUST receive each value exactly as they were sent in each Stream Chunk. However, Octet Streams are more lenient: the user MAY receive the Stream's octets in slices that differ from the slices that were delivered by the Stream Chunks, as long as the total concatenation of all slices remains unchanged.

### 7.2 Stream Cancellation message

Users SHOULD have the ability to "cancel" a Stream that they received. If a user decides to cancel such a Stream, its Stream ID MUST immediately be removed from the set of "received Stream IDs".

Also, if (and only if) the cancelled Stream ID was actually in the set of "received Stream IDs", the cancelling Peer MUST immediately send a Stream Cancellation message serialized as an Array of these two elements:

- The first element is an Integer whose value is "8".
- The second element is an Integer whose value is the associated Stream ID.

Attempting to cancel a Stream more than once, or attempting to cancel a Stream after already receiving an associated Final Stream Chunk, naturally results in a no-op. In such cases, a Stream Cancellation SHOULD NOT be sent.

After a Peer receives a Stream Cancellation, it SHOULD NOT ever send any more Stream Chunks with the same Stream ID across the same WebSocket connection. If a Peer receives a Stream Cancellation containing a Stream ID that is not within its set of "sent Stream IDs", it MUST ignore it.

When a Peer receives a WebSocket message that it must ignore, there is a possibility that the ignored message contains one or more Streams. In such cases, the Peer MUST immediately send a Stream Cancellation for each of the received Streams. This may occur in the following situations:

- Client receives a Response whose Request ID is not within the set of "open Request IDs" (see section 5).
- Server receives a Request for a method that is not implemented (see section 5).
- Peer receives a message that is an Array whose first element is an Integer not defined by this specification (see section 3).

### 7.3 Stream Signal message

Stream Signal messages are sent by the receiver of a Stream to provide hints for the Stream's sender to operate more efficiently. This process is often referred to as "flow control" or "backpressure".

When a Peer initially receives a Stream, they MUST promptly send a Stream Signal. Also, an additional Stream Signal MUST be sent each time the available space in the Stream's associated buffer changes by some fixed amount (this amount may vary per Stream), compared to when the previous Stream Signal was sent. For example, if a Stream Signal is sent when the buffer's available space is 10 MiB, then the next Stream Signal could be sent when the available space crosses either 5 MiB or 15 MiB. A Stream Signal is serialized as an Array with these four elements:

- The first element is an Integer whose value is "9".
- The second element is an Integer whose value is the associated Stream ID.
- The third element is an Integer whose value is sum of the sizes of all Stream Data received so far for the associated Stream, in KiB (rounded down). For the first Stream Signal associated with a Stream, this will generally be "0".
- The fourth element is an Integer whose value represents the number of KiB (rounded down) of remaining space in the receiver's buffer for the associated Stream.

Each time a Peer receives a Stream Signal, it is RECOMMENDED that they pause the stream unless/until the supposed available space is greater than or equal to the size of their next unsent piece of Stream Data. Additionally, it is RECOMMENDED that they compare the Stream Signal's third element with their own record of sent Stream Data to more accurately predict the other Peer's available space, despite any network latency.

Peers MAY ignore any Stream Signal that they receive. Therefore, buffers associated with Streams need to be prepared to buffer any amount of data. In other words, the fourth element of a Stream Signal does not necessarily represent a true "hard limit" on available space.

After a Peer sends a Stream Cancellation *or* receives a Final Stream Chunk, it SHOULD NOT ever send any more Stream Signals with the same Stream ID across the same WebSocket connection. If a Peer receives a Stream Signal containing a Stream ID that is not within its set of "sent Stream IDs, it MUST ignore it.

When a Peer receives a Stream, it MAY choose to immediately reply with a Stream Cancellation. In such cases, the Peer is not required to send a Stream Signal as it normally would.

## 8 Error

It's useful to have a consistent way of representing application errors. To that end, BlueRPC defines the Error extension type for MessagePack.

The Error extension type MUST be assigned to the extension type "1". Serializers MUST encode its "data segment" as a Map with at least one String key called "message" whose value is a String. The Map MAY have other key-value pairs.

## 9 WebSocket handling

A BlueRPC connection inherits the same lifecycle as the underlying WebSocket connection. Therefore, a BlueRPC connection is established the moment a WebSocket connection is successfully established, and a BlueRPC connection is considered "closed" the moment its underlying WebSocket connection is considered "closed".

If a Peer closes a BlueRPC connection without error, they SHOULD use the status code "1000" or "1001".

### 8.1 WebSocket compression

It is RECOMMENDED for BlueRPC Server and Client implementations to support the [permessage-deflate][4] WebSocket extension. It is RECOMMENDED that this extension is enabled by default, with default extension parameters that are appropriate for the implementation's use-cases.

### 8.2 WebSocket payload limits

Implementations MAY enforce a limit on the size of individual WebSocket messages that they receive, to limit memory consumption. However, implementations MUST support receiving WebSocket messages at least 256 KiB in size.

When sending Stream Chunks associated with an Octet Stream, Peers SHOULD limit the size of each Stream Chunk to be less than or equal to 256 KiB.

If a Peer receives a message whose size exceeds their supported limit, they SHOULD close the WebSocket connection with a status code of "1009".

### 8.3 WebSocket timeouts and heartbeats

BlueRPC defines a heartbeat mechanism for automatically closing hanging connections. Implementations MUST configure three variables for controlling these timeouts (whether or not these variables are configurable by the user is OPTIONAL):

- HANDSHAKE_TIMEOUT (RECOMMENDED default is 10 seconds)
- HEARTBEAT_INTERVAL (RECOMMENDED default is 3 seconds)
- HEARTBEAT_TRIES (RECOMMENDED default is 3)

If a WebSocket connection cannot be established within {HANDSHAKE_TIMEOUT} seconds, the Client MUST abort the connection attempt.

Upon establishing a WebSocket connection, the Server MUST start sending WebSocket "ping" frames at the regular interval defined by {HEARTBEAT_INTERVAL}. The value of {HEARTBEAT_INTERVAL} MUST NOT be greater than 10 seconds. Each "ping" frame MUST contain exactly one byte of payload data, where the byte is an 8-bit unsigned integer equal to the number of future "ping" frames that will be sent before the connection is terminated due to inactivity. For example, if {HEARTBEAT_TRIES} is 3, then the first ping will contain the byte "2". If the client is inactive, the next ping will contain "1", then "0". When the Server would send a ping containing the number "-1", instead it SHOULD close the WebSocket connection with a status code of "1001".

Whenever the Server receives a Request or Notification, it SHOULD reset the heartbeat countdown, therefore keeping the connection alive. Also, if the Server's set of "open Request IDs", "sent Stream IDs", or "received Stream IDs" is non-empty, then upon receiving any message, WebSocket "ping" frame, *or* WebSocket "pong" frame, the Server SHOULD reset the heartbeat countdown.

Servers MUST NOT ever close a WebSocket connection with a status code of "1001" except due to heartbeat timeout. Thus, Clients receiving a status code of "1001" MAY interpret it as an opportunity to re-connect and retry an RPC call that failed due to heartbeat timeout.



[1]: https://www.rfc-editor.org/rfc/rfc6455
[2]: https://github.com/msgpack/msgpack/blob/master/spec.md
[3]: https://www.ietf.org/rfc/rfc2119.txt
[4]: https://www.rfc-editor.org/rfc/rfc7692#section-7
