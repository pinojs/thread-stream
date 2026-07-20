import { expectType } from "tsd";
import { type Transferable, MessageChannel } from "worker_threads";
import ThreadStream from "../../index";

const stream = new ThreadStream({ filename: "./worker.js" });

expectType<boolean>(stream.write("hello"));
expectType<void>(stream.end());
expectType<void>(stream.flush());
expectType<void>(stream.flushSync());

// emit overload for posting a message to the worker,
// optionally with a list of transferable objects
const { port1 } = new MessageChannel();
expectType<boolean>(stream.emit("message", { foo: "bar" }));
expectType<boolean>(stream.emit("message", { foo: "bar" }, [port1]));
expectType<boolean>(stream.emit("message", "data", [new ArrayBuffer(8)]));

// the transferList parameter of the 'message' overload must be Transferable[]
// (Parameters<> resolves to the last overload, which is the 'message' one)
expectType<Transferable[] | undefined>(
  undefined as unknown as Parameters<ThreadStream["emit"]>[2],
);

// generic EventEmitter emit
expectType<boolean>(stream.emit("drain"));
