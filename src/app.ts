import { AppRoutes } from "./application/routes";
import { Server } from "./application/server";
import { envs } from "./config/plugins/envs.plugin";

(async () => {
  main();
})();

function main() {
  const server = new Server({
    port: envs.PORT,
    publicPath: envs.PUBLIC_PATH,
    routes: AppRoutes.routes,
  });
  server.start();
}
