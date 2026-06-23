import handler from "./[...path].js";

export default function badgesRoute(req, res) {
  req.query.path = ["badges"];
  return handler(req, res);
}
