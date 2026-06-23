import handler from "../[...path].js";

export default function profileRoute(req, res) {
  req.query.path = ["me", "profile"];
  return handler(req, res);
}
