import { ensureDatabase, closeDatabase } from "./index";

ensureDatabase();
closeDatabase();
console.log("Database migrations applied.");
