import { makeRouter } from "@/lib/api/router";
import { adminRoutes } from "@/lib/api/adminroutes";
import { requireAdmin } from "@/lib/auth";

const handler = makeRouter(adminRoutes, requireAdmin);
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
