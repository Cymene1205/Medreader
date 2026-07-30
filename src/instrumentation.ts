export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    process.on("unhandledRejection", (reason, promise) => {
      console.error("[FATAL] Unhandled Rejection:", reason);
    });
    process.on("uncaughtException", (err) => {
      console.error("[FATAL] Uncaught Exception:", err);
    });
    console.log("[instrumentation] error handlers registered");
  }
}
