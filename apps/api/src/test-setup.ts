import { prisma } from "./config/prisma";
import { installUnfilteredDeleteGuard } from "./test-guard";

// Runs before every test file: see test-guard.ts for why.
installUnfilteredDeleteGuard(prisma);
