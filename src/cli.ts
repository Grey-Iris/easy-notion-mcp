#!/usr/bin/env node
import "dotenv/config";
import { runCli } from "./cli/run.js";

const exitCode = await runCli(process.argv.slice(2));
process.exit(exitCode);
