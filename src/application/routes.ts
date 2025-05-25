import { Router } from "express";

export class AppRoutes {
  static get routes(): Router {
    const routes = Router();

    // routes.get("/", (req, res) => {
    //   res.status(200).send({
    //     message: "Hello World!",
    //   });
    // });

    return routes;
  }
}
