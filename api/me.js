import { route, send, currentUser, signupCodeRequired } from './_lib.js';

// Who is signed in. The app calls this on load to decide whether sync is available.
export default route(['GET'], async (req, res) => {
  const user = await currentUser(req);
  send(res, 200, { user: user ? { email: user.email } : null, signupCodeRequired: signupCodeRequired() });
});
