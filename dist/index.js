"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const events_1 = require("events");
const ws_1 = __importDefault(require("ws"));
const http = __importStar(require("http"));
const os_1 = __importDefault(require("os"));
const util_1 = __importDefault(require("util"));
const form_data_1 = __importDefault(require("form-data"));
const stream_1 = require("stream");
const util_2 = require("util");
const stream_2 = __importDefault(require("stream"));
const pipeline = (0, util_2.promisify)(stream_2.default.pipeline);
let child;
let lastRequestID;
const cleanExit = async (message, exit) => {
    if (message)
        console.log(message);
    exit = exit ?? true;
    child?.kill();
    if (exit)
        process.exit();
};
process.on("SIGINT", () => cleanExit());
process.on("SIGTERM", () => cleanExit());
const handleSpawn = (debug, fileName, port, filePath) => {
    const execPath = filePath ? `"${filePath}"` : `"${path_1.default.join(__dirname, fileName)}"`;
    child = (0, child_process_1.spawn)(execPath, {
        env: { WS_PORT: port.toString() },
        shell: true,
        windowsHide: true,
        detached: process.platform !== "win32"
    });
    child.stderr.on("data", (stderr) => {
        if (stderr.toString().includes("Request_Id_On_The_Left")) {
            const splitRequestIdAndError = stderr.toString().split("Request_Id_On_The_Left");
            const [requestId, error] = splitRequestIdAndError;
            //TODO Correctly parse logging messages
            // this.emit(requestId, { error: new Error(error) });
        }
        else {
            debug
                ? cleanExit(new Error(stderr))
                //TODO add Correct error logging url request/ response/
                : cleanExit(`Error Processing Request (please open an issue https://github.com/Danny-Dasilva/CycleTLS/issues/new/choose) -> ${stderr}`, false).then(() => handleSpawn(debug, fileName, port));
        }
    });
};
// Function to convert a stream into a string
async function streamToString(stream) {
    const chunks = [];
    await pipeline(stream, new stream_1.Writable({
        write(chunk, encoding, callback) {
            chunks.push(chunk);
            callback();
        }
    }));
    return Buffer.concat(chunks).toString('utf8');
}
class Golang extends events_1.EventEmitter {
    server;
    queue;
    host;
    queueId;
    timeout;
    port;
    debug;
    filePath;
    failedInitialization = false;
    constructor(port, debug, timeout, filePath) {
        super();
        this.port = port;
        this.debug = debug;
        this.timeout = timeout;
        this.filePath = filePath;
        this.checkSpawnedInstance();
    }
    checkSpawnedInstance() {
        let server = http.createServer();
        server.listen(this.port)
            .on('listening', () => {
            server.close(() => {
                this.spawnServer();
                this.host = true;
            });
        })
            .on('error', () => {
            this.createClient();
            this.host = false;
        });
    }
    spawnServer() {
        const PLATFORM_BINARIES = {
            "win32": { "x64": "index.exe" },
            "linux": { "arm": "index-arm", "arm64": "index-arm64", "x64": "index" },
            "darwin": { "x64": "index-mac", "arm": "index-mac-arm", "arm64": "index-mac-arm64" },
            "freebsd": { "x64": "index-freebsd" }
        };
        const executableFilename = PLATFORM_BINARIES[process.platform]?.[os_1.default.arch()];
        if (!executableFilename) {
            cleanExit(new Error(`Unsupported architecture ${os_1.default.arch()} for ${process.platform}`));
        }
        handleSpawn(this.debug, executableFilename, this.port, this.filePath);
        this.createClient();
    }
    createClient() {
        // In-line function that represents a connection attempt
        const attemptConnection = () => {
            const server = new ws_1.default(`ws://localhost:${this.port}`);
            server.on("open", () => {
                // WebSocket connected - set server and emit ready
                this.server = server;
                this.server.on("message", (data) => {
                    const message = JSON.parse(data);
                    this.emit(message.RequestID, message);
                });
                this.emit("ready");
            });
            server.on("error", (err) => {
                // Connection error - retry in .1s
                server.removeAllListeners();
                setTimeout(() => {
                    // If we've failed to initialize, stop the loop
                    if (this.failedInitialization) {
                        return;
                    }
                    attemptConnection();
                }, 100);
            });
        };
        attemptConnection();
        // Set a timeout representing the initialization timeout that'll reject the promise if not initialized within the timeout
        setTimeout(() => {
            this.failedInitialization = true;
            this.emit("failure", `Could not connect to the CycleTLS instance within ${this.timeout}ms`);
        }, this.timeout);
    }
    async request(requestId, options) {
        lastRequestID = requestId;
        // Check if options.body is URLSearchParams and convert to string
        if (options.body instanceof URLSearchParams) {
            options.body = options.body.toString();
        }
        // Check if options.body is FormData and convert to string
        if (options.body instanceof form_data_1.default) {
            options.headers = { ...options.headers, ...options.body.getHeaders() };
            options.body = await streamToString(options.body);
        }
        if (this.server) {
            this.server.send(JSON.stringify({ requestId, options }), (err) => {
                // An error occurred sending the webhook to a server we already confirmed exists - let's get back up and running
                // First, we'll create a queue to store the failed request
                // Do a check to make sure server isn't null to prevent a race condition where multiple requests fail
                if (err) {
                    if (this.server != null) {
                        // Add failed request to queue
                        this.server = null;
                        // Just resend the request so that it adds to queue properly
                        this.request(requestId, options);
                        // Start process of client re-creation
                        this.checkSpawnedInstance();
                    }
                    else {
                        // Add to queue and hope server restarts properly
                        this.queue.push(JSON.stringify({ requestId, options }));
                    }
                }
            });
        }
        else {
            if (this.queue == null) {
                this.queue = [];
            }
            this.queue.push(JSON.stringify({ requestId, options }));
            if (this.queueId == null) {
                this.queueId = setInterval(() => {
                    // If we failed to initialize - clear the queue
                    if (this.failedInitialization) {
                        clearInterval(this.queueId);
                        this.queue = [];
                        this.queueId = null;
                        return;
                    }
                    // If the server is available - empty the queue into the server and delete the queue
                    if (this.server) {
                        for (let request of this.queue) {
                            this.server.send(request);
                        }
                        this.queue = [];
                        clearInterval(this.queueId);
                        this.queueId = null;
                    }
                }, 100);
            }
        }
    }
    exit() {
        return new Promise((resolve, reject) => {
            this.server.close();
            if (this.host) {
                child?.kill();
                resolve(null);
            }
            else {
                resolve(null);
            }
        });
    }
}
const initCycleTLS = async (initOptions = {}) => {
    return new Promise((resolveReady, reject) => {
        let { port, debug, timeout, executablePath } = initOptions;
        if (!port)
            port = 9119;
        if (!debug)
            debug = false;
        if (!timeout)
            timeout = 4000;
        const instance = new Golang(port, debug, timeout, executablePath);
        instance.on("ready", () => {
            const CycleTLS = (() => {
                const CycleTLS = async (url, options, method = "get") => {
                    return new Promise((resolveRequest, rejectRequest) => {
                        const requestId = `${url}${Math.floor(Date.now() * Math.random())}`;
                        //set default options
                        options = options ?? {};
                        //set default ja3, user agent, body and proxy
                        if (!options?.ja3)
                            options.ja3 = "771,4865-4867-4866-49195-49199-52393-52392-49196-49200-49162-49161-49171-49172-51-57-47-53-10,0-23-65281-10-11-35-16-5-51-43-13-45-28-21,29-23-24-25-256-257,0";
                        if (!options?.userAgent)
                            options.userAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.54 Safari/537.36";
                        if (!options?.body)
                            options.body = "";
                        if (!options?.proxy)
                            options.proxy = "";
                        if (!options?.insecureSkipVerify)
                            options.insecureSkipVerify = false;
                        if (!options?.forceHTTP1)
                            options.forceHTTP1 = false;
                        //convert simple cookies
                        const cookies = options?.cookies;
                        if (typeof cookies === "object" &&
                            !Array.isArray(cookies) &&
                            cookies !== null) {
                            const tempArr = [];
                            for (const [key, value] of Object.entries(options.cookies)) {
                                tempArr.push({ name: key, value: value });
                            }
                            options.cookies = tempArr;
                        }
                        instance.request(requestId, {
                            url,
                            ...options,
                            method,
                        });
                        instance.once(requestId, (response) => {
                            if (response.error)
                                return rejectRequest(response.error);
                            try {
                                //parse json responses
                                response.Body = JSON.parse(response.Body);
                                //override console.log full repl to display full body
                                response.Body[util_1.default.inspect.custom] = function () { return JSON.stringify(this, undefined, 2); };
                            }
                            catch (e) { }
                            const { Status: status, Body: body, Headers: headers, FinalUrl: finalUrl } = response;
                            if (headers["Set-Cookie"])
                                headers["Set-Cookie"] = headers["Set-Cookie"].split("/,/");
                            resolveRequest({
                                status,
                                body,
                                headers,
                                finalUrl,
                            });
                        });
                    });
                };
                CycleTLS.head = (url, options) => {
                    return CycleTLS(url, options, "head");
                };
                CycleTLS.get = (url, options) => {
                    return CycleTLS(url, options, "get");
                };
                CycleTLS.post = (url, options) => {
                    return CycleTLS(url, options, "post");
                };
                CycleTLS.put = (url, options) => {
                    return CycleTLS(url, options, "put");
                };
                CycleTLS.delete = (url, options) => {
                    return CycleTLS(url, options, "delete");
                };
                CycleTLS.trace = (url, options) => {
                    return CycleTLS(url, options, "trace");
                };
                CycleTLS.options = (url, options) => {
                    return CycleTLS(url, options, "options");
                };
                CycleTLS.connect = (url, options) => {
                    return CycleTLS(url, options, "options");
                };
                CycleTLS.patch = (url, options) => {
                    return CycleTLS(url, options, "patch");
                };
                CycleTLS.exit = async () => {
                    return instance.exit();
                };
                return CycleTLS;
            })();
            resolveReady(CycleTLS);
        });
        instance.on("failure", (reason) => {
            reject(reason);
        });
    });
};
exports.default = initCycleTLS;
// CommonJS support for default export
module.exports = initCycleTLS;
module.exports.default = initCycleTLS;
module.exports.__esModule = true;
