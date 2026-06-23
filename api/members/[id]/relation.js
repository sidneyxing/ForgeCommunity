import handler from "../../[...path].js";

export default function relationRoute(req, res) {
  req.query.path = ["members", req.query.id, "relation"];
  return handler(req, res);
}
