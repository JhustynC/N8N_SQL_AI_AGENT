import { Router } from "express";
import express from "express";
import * as http from "http";

export interface ServerOptions {
  port: number;
  routes: Router;
  publicPath?: string;
}

export class Server {
  private readonly app = express();
  private http?: http.Server;
  private readonly port: number;
  private readonly routes: Router;
  private readonly publicPath?: string;

  constructor(options: ServerOptions) {
    const { port, routes, publicPath } = options;

    this.port = port;
    this.routes = routes;
    this.publicPath = publicPath;
  }

  public get invoke(): express.Application {
    return this.app;
  }

  async start() {
    //* Start Configurations

    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    // this.app.use(cors());
    // this.app.use(compresion());
    // this.app.use(morgan('dev'));

    //* Routes
    this.app.use(this.routes);

    //? Sessions Config
    // this.app.use(session({}));

    //* Public Folder
    this.app.use(express.static(this.publicPath || "public"));

    //* Simple Error Handler
    this.app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
      res.status(500).json({ error: err.message });
    });

    //* Start Server
    this.http = this.app.listen(this.port, () => {
      console.log(`Server running`);
      console.log(`http://localhost:${this.port}`);
    });
  }

  public stop = async () => {
    try {
      if (this.http) {
        console.log("Closing Server...");
        this.http?.close();
      }
    } catch (error) {
      console.error(error);
    }
  };
}
