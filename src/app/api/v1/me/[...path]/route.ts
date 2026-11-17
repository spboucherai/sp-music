import { makeRouter } from "@/lib/api/router";
import { meRoutes } from "@/lib/api/meroutes";
import { requireUser } from "@/lib/auth";

const handler = makeRouter(meRoutes, requireUser);
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
