import { makeRouter } from "@/lib/api/router";
import { authRoutes } from "@/lib/api/authroutes";
import { clientIp } from "@/lib/http";

const handler = makeRouter(authRoutes, async (req) => ({ ip: clientIp(req) }));
export { handler as GET, handler as POST };
