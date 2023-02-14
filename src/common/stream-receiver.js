'use strict';
const Stream = require('./stream');
const { parseStream } = require('./parse-message');

// The HIGH_WATER_MARK determines how much incoming data we'll buffer before
// applying backpressure to the sender of the Stream. It limits our memory usage
// when we receive data much faster than it gets consumed. However, if the
// HIGH_WATER_MARK is too small, we can end up severely hurting the stream's
// performance by overly restricting the sender's ability to provide us with
// data promptly. Many benchmarks across different network conditions have led
// to us using a HIGH_WATER_MARK of 8 MiB, which seems to maximize performance
// while still keeping memory consumption under control, even in networks with
// up to 2 Gbps transfer speeds and 500ms round-trip latency.
const HIGH_WATER_MARK = 1024 * 1024 * 8;

module.exports = class StreamReceiver {
	constructor(stream, encoder, { onCancellation, onSignal }) {
		this._stream = stream;
		this._encoder = encoder;
		this._shouldDecode = !Stream.isOctetStream(stream);
		this._buffer = [];
		this._bufferSize = 0;
		this._credit = HIGH_WATER_MARK;
		this._backpressure = false;
		this._paused = false;
		this._ended = false;
		this._destroyed = false;
		this._didSignal = false;
		this._onCancellation = onCancellation;
		this._onSignal = onSignal;

		this._writer = Stream.populate(stream, {
			onResume: () => {
				this._paused = false;
				let index = 0;
				while (index < this._buffer.length && !this._paused) {
					const data = this._buffer[index++];
					this._bufferSize -= data.byteLength;
					this._handleData(data);
				}
				if (!this._destroyed) {
					// TODO: this could be optimized by using a real Queue data structure
					this._buffer = this._buffer.slice(index);
					if (this._ended) {
						if (!this._bufferSize) {
							this._writer.end();
						}
					} else {
						this._checkSignal();
					}
				}
			},
			onDestroyed: () => {
				this._buffer = [];
				this._bufferSize = 0;
				this._destroyed = true;
				this._onCancellation();
				this._onCancellation = () => {};
				this._onSignal = () => {};
				this._writer.write = () => {};
				this._writer.end = () => {};
				this._writer.error = () => {};
			},
		});

		Promise.resolve().then(() => {
			if (!this._didSignal) {
				this._onSignal(null);
				this._didSignal = true;
			}
		});
	}

	_checkSignal() {
		// We use an optimistic flow control algorithm that tries to keep memory
		// consumption under control, but optimizes for speed by being lenient.
		// Initially, senders are permitted to send as much data as they can.
		// Only if the HIGH_WATER_MARK is breached do we start enforcing the
		// credit-based system. If/when the buffer size falls to zero, we revert
		// back to the initial policy of allowing the sender to ignore credits.
		// This cycle may repeat any number of times until the stream is done.
		if (this._backpressure) {
			if (this._bufferSize === 0) {
				this._backpressure = false;
				this._onSignal(null);
				this._didSignal = true;
			} else if (this._credit > 0) {
				this._onSignal(this._credit);
				this._credit = 0;
				this._didSignal = true;
			}
		} else {
			if (this._bufferSize > HIGH_WATER_MARK) {
				this._backpressure = true;
				this._onSignal(this._credit);
				this._credit = 0;
				this._didSignal = true;
			}
		}
	}

	_handleData(data) {
		if (this._shouldDecode) {
			let value;
			try {
				value = parseStream(data, this._encoder);
			} catch (err) {
				this._onCancellation(err);
				this.error(new Error(`BlueRPC: ${err.message}`));
				return;
			}
			if (Stream.canWriteNull || value !== null) {
				this._paused = !this._writer.write(value);
			}
		} else {
			this._paused = !this._writer.write(data);
		}
		this._credit += data.byteLength;
	}

	write(data) {
		if (this._paused) {
			this._buffer.push(data);
			this._bufferSize += data.byteLength;
			this._checkSignal();
		} else {
			this._handleData(data);
			if (!this._destroyed && !this._ended) {
				this._checkSignal();
			}
		}
	}

	end() {
		this._ended = true;
		if (!this._bufferSize) {
			this._buffer = [];
			this._writer.end();
		}
	}

	error(err) {
		// We need to delay this by one tick, so that clients who received the
		// stream within a response are guaranteed access to the stream before
		// the "error" event is emitted.
		Promise.resolve().then(() => {
			this._buffer = [];
			this._bufferSize = 0;
			this._destroyed = true;
			this._writer.error(err);
		});
	}
};
