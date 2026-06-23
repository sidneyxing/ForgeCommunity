import handler from "../[...path].js";

export default function authRoute(req, res) {
  req.query.path = ["auth", req.query.action];
  return handler(req, res);
}
