import { type Tracer } from "@opentelemetry/api";
import { TracerProvider, SimpleSpanProcessor, ConsoleSpanExporter } from "@opentelemetry/sdk-trace";

const provider = new TracerProvider({
  spanProcessors: [new SimpleSpanProcessor({ exporter: new ConsoleSpanExporter() })],
});

const _tracer: Tracer = provider.getTracer("predictify-backend", "0.1.0");

export function getTracer(): Tracer {
  return _tracer;
}