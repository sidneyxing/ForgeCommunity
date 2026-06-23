import handler from "../[...path].js";

export default function settingsRoute(req, res) {
  req.query.path = ["me", "settings"];
  return handler(req, res);
}
