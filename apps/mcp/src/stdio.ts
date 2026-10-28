import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MockData, isScenario } from "./data.js";
import { createForecastServer } from "./server.js";

// Local stdio server with sample data, for Claude Desktop, Claude Code, or the MCP
// Inspector while developing. It never touches real accounts.

const scenario = process.env.FORECAST_MOCK_SCENARIO;
const server = createForecastServer(new MockData(isScenario(scenario) ? scenario : "partly"), () => "demo");
await server.connect(new StdioServerTransport());
