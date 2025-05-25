import { config } from "dotenv";
import { get } from "env-var";

//? Init Env Varaibles
config();

export const envs = {
  PORT: get("PORT").required().asPortNumber(),
  PUBLIC_PATH: get("PUBLIC_PATH").required().asString(),
};
