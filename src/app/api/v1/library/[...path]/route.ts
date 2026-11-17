import { makeRouter } from "@/lib/api/router";
import { libraryRoutes } from "@/lib/api/libraryroutes";
import { requireUser } from "@/lib/auth";

const handler = makeRouter(libraryRoutes, requireUser);
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
