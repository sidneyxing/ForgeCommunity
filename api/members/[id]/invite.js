import handler from "../../[...path].js";

export default function inviteRoute(req, res) {
  req.query.path = ["members", req.query.id, "invite"];
  return handler(req, res);
}
