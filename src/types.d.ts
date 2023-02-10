import net from 'net';
import http from 'http';
import https from 'https';
import ws from 'ws';

declare namespace BlueRPC {
	function listen(options: ServerOptions): Promise<ws.WebSocketServer>;
	function createClient(url: string | URL, options?: ClientOptions): BlueClient;

	interface ServerOptions extends net.ListenOptions {
		server: http.Server | https.Server;
		methods: Record<string, Method>;
		maxPayload?: number | null;
		perMessageDeflate?: ws.PerMessageDeflateOptions | boolean;
		verifyClient?: ws.VerifyClientCallbackAsync | ws.VerifyClientCallbackSync | null;
		logger?: Logger | null;
	}

	interface ClientOptions extends https.RequestOptions {
		maxPayload?: number | null;
		perMessageDeflate?: ws.PerMessageDeflateOptions | boolean;
	}

	type Method = (param: any, ctx: MethodContext) => any;
	type Logger = (log: string) => void;

	interface BlueClient {
		invoke<Param = any, Result = any>(
			methodName: string,
			param: Param,
			signal?: AbortSignal
		): Promise<Result>;

		notify<Param = any>(
			methodName: string,
			param: Param
		): Promise<undefined>;

		cancel(): undefined;
	}

	interface MethodContext<CustomConnectionProps extends Record<string | symbol, any> = {}> {
		signal: AbortSignal;
		isAborted: boolean;
		isNotification: boolean;
		connection: {
			tls: boolean;
			headers: http.IncomingHttpHeaders;
		} & CustomConnectionProps;
	}
}

export = BlueRPC;
