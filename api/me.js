import handler from "./[...path].js";

export default function meRoute(req, res) {
  req.query.path = ["me"];
  return handler(req, res);
}
