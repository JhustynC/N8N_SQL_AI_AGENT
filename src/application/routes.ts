import { Router } from "express";

export class AppRoutes {
  static get routes(): Router {
    const routes = Router();

    routes.get("/status");
    routes.post("/reconnect");
    routes.post("/send-message");
    routes.post("/clear-session");

    // routes.get("/", (req, res) => {
    //   res.status(200).send({
    //     message: "Hello World!",
    //   });
    // });

    return routes;
  }
}

