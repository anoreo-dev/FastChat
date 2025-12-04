# FastChat Protocol (simple prototype)

Line-oriented text protocol. Each message is a single line terminated by `\n`. Fields are delimited by `|`.

Message types:

- CONNECT|<nickname>
  - Client sends to identify itself when connecting.

- CONNECTED|OK or CONNECTED|NICK_TAKEN
  - Broker replies to CONNECT.

- USERS|nick1,nick2,...
  - Broker broadcasts current online users whenever the list changes.

- PUBLISH|<from>|<to_type>|<target>|<kind>|<payload>
  - to_type: USER or GROUP
  - kind: TEXT or FILE
  - payload: for TEXT -> raw text (no newlines); for FILE -> filename::base64content

- MSG|<from>|<to_type>|<target>|<payload>
  - Broker -> client for text message delivery.

- FILE|<from>|<to_type>|<target>|<filename::base64>
  - Broker -> client for file delivery. Client saves file as recv_<filename>.

- END|<nickname>
  - Client notifies broker to end session and unregister.

Notes & limitations:
- This is intentionally simple for an assignment prototype.
- File transfers are sent base64-encoded in a single message. For large files this is inefficient and memory-heavy; a production system would chunk, stream, or use a separate transfer channel.
- No authentication; nickname uniqueness enforced by the broker.
- Group management: a default public group `main` exists and all clients can publish to it; join/leave semantics are minimal.
