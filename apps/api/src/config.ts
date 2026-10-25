import dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "..", ".env") });

const production = process.env.NODE_ENV === "production";
export const resolveWebOrigin = (webOrigin: string | undefined, isProduction: boolean) => {
  const configuredOrigin = webOrigin?.trim();
  return new URL(configuredOrigin || (isProduction ? "https://safestride-web.onrender.com" : "http://localhost:5173")).origin;
};
const secret = process.env.JWT_SECRET;
if (production && (!secret || secret.length < 32)) {
  throw new Error("JWT_SECRET must contain at least 32 characters in production.");
}

export const config = {
  port: Number(production ? process.env.PORT ?? 4000 : process.env.API_PORT ?? 4000),
  origin: resolveWebOrigin(process.env.WEB_ORIGIN, production),
  jwtSecret: secret ?? "local-development-secret-change-before-deploy-123456",
  notificationProvider: process.env.NOTIFICATION_PROVIDER ?? "simulated",
  production,
};

if (config.notificationProvider !== "simulated") {
  throw new Error("Only the simulated notification provider is currently implemented.");
}
