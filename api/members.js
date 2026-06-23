import handler from "./[...path].js";

export default function membersRoute(req, res) {
  req.query.path = ["members"];
  return handler(req, res);
}
