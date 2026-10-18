# TicketHub Design Document

TicketHub is a website that sells tickets for concerts and events.
This document follows the six-part framework: requirements, estimates,
API, data model, architecture and trade-offs.

## 1. Requirements

### Functional requirements
- Users can register and log in.
- Users can browse and search upcoming events.
- Users can view the seat map of an event and see which seats are free.
- Users can hold seats for a short time (5 minutes).
- Users can pay for held seats and receive tickets.
- Users can view their tickets and past orders.
- Held seats that are not paid for are released automatically.

### Non-functional requirements
- **Correctness (most important):** a seat is never sold to two people.
  Money is never taken for a seat the buyer does not get.
- **Speed:** browsing pages load in under 500 ms; holding a seat
  responds in under 1 second, even during a big sale.
- **Fairness:** during a big sale, people are served in the order they
  arrived, and bots cannot grab many seats.
- **Availability:** the site stays up during a big sale (99.9% uptime).
  If it is overloaded, it slows down gracefully and does not crash.
- **Scale:** 2 million registered users and sudden spikes of
  hundreds of times normal traffic.
- **Security and durability:** HTTPS, hashed passwords, no card details
  stored by us, and completed orders are never lost.

## 2. Estimates

A day has 86,400 seconds. Peak means 5 times the average.

### Normal day
- Page views: 50,000 visitors x 10 pages = 500,000 per day, about
  **6 per second** on average and about **30 per second** at peak.
- Ticket sales: 5,000 per day = about **0.06 per second**.
- Conclusion: a normal day is very light. Reads far outnumber writes.

### Big sale (200,000 people, 20,000 seats, 10 minutes = 600 seconds)
- Assumption: each person makes about 10 requests.
- People arriving: 200,000 / 600 = about **333 per second**.
- Requests: 2,000,000 / 600 = about **3,300 per second**.
- Seat-hold attempts: about **333 per second**.
- Best-case sales: 20,000 / 600 = about **33 per second**.
- Only 10% of people can succeed, so 90% must receive a fast
  "sold out" answer.

### Comparison
Requests are about **550 times higher** than a normal day, and seat
holds are thousands of times higher. We cannot size the whole system
for the big sale all year, so we design for **bursts**: a waiting room,
caching, extra servers added on demand, and a queue for slow work.

## 3. API

Base URL: `https://api.tickethub.example/v1`. All requests and
responses use JSON. Every endpoint except login and browsing needs
`Authorization: Bearer <token>`.

| Method | Path | Description | Success status |
|---|---|---|---|
| POST | `/auth/login` | Log in and get a token | 200 OK |
| GET | `/events` | List events (`?page=`, `?q=`, `?date=`) | 200 OK |
| GET | `/events/{id}` | Get one event's details | 200 OK |
| GET | `/events/{id}/seats` | View seats and their status (`?section=`) | 200 OK |
| POST | `/events/{id}/holds` | Hold one or more seats for 5 minutes | 201 Created |
| DELETE | `/events/{id}/holds` | Release my held seats | 204 No Content |
| POST | `/orders` | Pay for my held seats | 201 Created |
| GET | `/users/me/tickets` | View my tickets | 200 OK |

### Example: hold seats

`POST /events/12/holds`

```json
{ "seat_ids": [301, 302] }
```

Response `201 Created`:

```json
{
  "event_id": 12,
  "seat_ids": [301, 302],
  "expires_at": "2026-12-05T10:05:00Z"
}
```

### Example: pay

`POST /orders` with the header `Idempotency-Key: 8f1c...` (so a
double-click or retry cannot charge twice):

```json
{
  "event_id": 12,
  "seat_ids": [301, 302],
  "payment_token": "tok_abc123"
}
```

Response `201 Created`:

```json
{
  "order_id": 9001,
  "status": "paid",
  "total_cents": 20000,
  "tickets": [301, 302]
}
```

### Error codes

| Status | Example |
|---|---|
| 400 Bad Request | `seat_ids` is empty or more than 6 seats requested |
| 401 Unauthorized | Missing or expired token |
| 404 Not Found | `GET /events/9999` for an event that does not exist |
| 409 Conflict | Someone else already holds or bought that seat |
| 410 Gone | The 5-minute hold expired before payment |
| 402 Payment Required | The payment was declined |
| 429 Too Many Requests | Too many requests from one user (bot protection) |

## 4. Data model

### users
| Column | Type | Rules |
|---|---|---|
| id | INTEGER | Primary key |
| email | TEXT | NOT NULL, UNIQUE |
| name | TEXT | NOT NULL |
| password_hash | TEXT | NOT NULL |

### events
| Column | Type | Rules |
|---|---|---|
| id | INTEGER | Primary key |
| title | TEXT | NOT NULL |
| venue | TEXT | NOT NULL |
| starts_at | TEXT | NOT NULL |
| on_sale_at | TEXT | NOT NULL |

### seats
| Column | Type | Rules |
|---|---|---|
| id | INTEGER | Primary key |
| event_id | INTEGER | Foreign key to events(id), NOT NULL |
| section, row_label, seat_number | TEXT / TEXT / INTEGER | NOT NULL |
| price_cents | INTEGER | NOT NULL |
| status | TEXT | 'available', 'held' or 'sold' |
| held_by | INTEGER | Foreign key to users(id), empty when not held |
| hold_expires_at | TEXT | Empty when not held |

`UNIQUE (event_id, section, row_label, seat_number)` stops the same
physical seat existing twice.

### orders
| Column | Type | Rules |
|---|---|---|
| id | INTEGER | Primary key |
| user_id | INTEGER | Foreign key to users(id), NOT NULL |
| total_cents | INTEGER | NOT NULL |
| status | TEXT | 'paid' or 'refunded' |
| idempotency_key | TEXT | NOT NULL, UNIQUE |
| created_at | TEXT | NOT NULL |

### order_items
| Column | Type | Rules |
|---|---|---|
| id | INTEGER | Primary key |
| order_id | INTEGER | Foreign key to orders(id), NOT NULL |
| seat_id | INTEGER | Foreign key to seats(id), NOT NULL, **UNIQUE** |

### Relationships
- **users to orders: one-to-many.** One user has many orders; each
  order belongs to one user.
- **events to seats: one-to-many.** One event has many seats; each seat
  belongs to one event.
- **orders to seats: many-to-many in principle** (an order has many
  seats), but in practice a seat can be sold only once. The join table
  `order_items` links them, and `UNIQUE (seat_id)` makes each seat
  appear in at most one order.

```sql
CREATE TABLE seats (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id        INTEGER NOT NULL,
  section         TEXT NOT NULL,
  row_label       TEXT NOT NULL,
  seat_number     INTEGER NOT NULL,
  price_cents     INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'available'
                  CHECK (status IN ('available', 'held', 'sold')),
  held_by         INTEGER,
  hold_expires_at TEXT,
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (held_by)  REFERENCES users(id),
  UNIQUE (event_id, section, row_label, seat_number)
);

CREATE TABLE order_items (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  seat_id  INTEGER NOT NULL UNIQUE,
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (seat_id)  REFERENCES seats(id)
);
```

Index: `CREATE INDEX idx_seats_event_status ON seats(event_id, status);`
because "show free seats for this event" is the most common query.

## 5. How double-booking is prevented

Two safety nets protect every seat.

**Safety net 1: an atomic conditional update.** To hold a seat, the app
runs a single statement:

```sql
UPDATE seats
SET status = 'held', held_by = :user_id,
    hold_expires_at = :now_plus_5_minutes
WHERE id = :seat_id
  AND (status = 'available'
       OR (status = 'held' AND hold_expires_at < :now));
```

The database changes one row at a time, so if two users click the same
seat together, one statement changes 1 row (that user wins) and the
other changes 0 rows (that user gets `409 Conflict`). We check the
number of changed rows instead of reading first and writing later,
because "check, then write" in two steps would let both users pass the
check.

**Several seats, all or nothing.** Holding or paying for several seats
runs inside one **transaction**. If any seat fails, the transaction
rolls back and none of the seats are held.

**Paying.** In one transaction, the app checks that every seat is still
held by this user and not expired (`status = 'held' AND held_by = :user
AND hold_expires_at > :now`). If the number of matching seats is wrong,
it rolls back and returns `410 Gone`. Otherwise it creates the order,
inserts the `order_items`, sets the seats to `sold`, and commits. The
payment uses an **idempotency key**, so a retry cannot charge twice. If
we charged the card but the transaction fails, we refund automatically.

**Safety net 2: a constraint.** `UNIQUE (seat_id)` on `order_items`
means the database refuses a second sale of the same seat, even if our
code had a bug.

**Expired holds.** A worker releases expired holds every minute, and the
`WHERE` clause above also lets a new buyer take a seat whose hold has
expired, so the seat is never stuck.

## 6. Architecture

```text
 +----------------+
 |  Client        |  (browser / mobile app)
 +---+--------+---+
     |        |
     |        v
     |    +-------+
     |    |  DNS  |
     |    +-------+
     v
 +-----------+      static pages and event images
 |    CDN    |<---- (served from servers near the user)
 +-----+-----+
       |  API requests
       v
 +---------------+     during a big sale, users wait here
 | Waiting room  |---- and are let in at a safe rate
 | + rate limit  |
 +-------+-------+
         v
 +----------------+
 | Load balancer  |
 +---+--------+---+
     |        |
     v        v
 +--------+ +--------+
 | App    | | App    |  ... many more are added
 | server | | server |      before a big sale
 +---+----+ +----+---+
     |           |
  +--+-----------+----------------+------------------+
  |                               |                  |
  v                               v                  v
 +--------+                +--------------+    +-----------+
 | Cache  |                | Primary DB   |    |  Queue    |
 | (Redis)|                | (all holds,  |    | (emails,  |
 | seat   |                |  orders)     |    |  expiry)  |
 | maps   |                +------+-------+    +-----+-----+
 +--------+                       | replication      |
                                  v                  v
                           +--------------+    +-----------+
                           | Read replica |    |  Worker   |
                           | (browsing)   |    +-----------+
                           +--------------+
                                                 Payment provider
                                              (external, called by the
                                                   app servers)
```

### What each component does
- **Client:** Solves the need for a screen to browse events and pick seats.
- **DNS:** Solves finding the site by name instead of by number.
- **CDN:** Solves slow, heavy pages by serving event pages and images
  from servers near the user, so most browsing never reaches us.
- **Waiting room and rate limiter:** Solves the crush of 200,000 people
  at once by letting them in at a safe rate, in arrival order, and by
  blocking bots that send too many requests.
- **Load balancer:** Solves one server being overloaded by spreading
  requests across many app servers and skipping unhealthy ones.
- **App servers:** Solve running the API logic and can be added quickly
  before a sale.
- **Cache (Redis):** Solves repeated reads of the seat map by keeping
  it in fast memory for a second or two, which takes most of the load
  off the database.
- **Primary database:** Solves correctness, because it is the one
  source of truth for seat status and orders, and it enforces the
  transactions and constraints.
- **Read replica:** Solves browsing overload by serving event and
  search reads away from the primary.
- **Queue:** Solves slow work blocking the buyer, by letting the app
  server hand over jobs (ticket emails, receipts) and reply at once.
- **Worker:** Solves doing the slow jobs in the background, including
  releasing expired holds.
- **Payment provider:** Solves handling card payments securely so that
  we never store card details.

### How it survives the big sale
1. **Before the sale:** extra app servers are started, and the event
   page and seat layout are cached.
2. **At the start:** the waiting room lets people in at about what the
   database can handle, so the system slows people down instead of
   crashing.
3. **Browsing seats:** the seat map is read from the cache (1-2 second
   delay), so thousands of refreshes do not hit the database.
4. **Holding seats:** only these small writes hit the primary database,
   and each is one fast conditional update.
5. **Sold out:** when the cache shows no seats left, the API quickly
   answers "sold out" without touching the database.
6. **Slow work:** emails are queued, not done during the purchase.

## 7. Trade-offs

1. **Correctness vs speed (database for holds).** Holding seats in the
   primary database is slower than holding them only in a fast cache
   such as Redis, but a database transaction is safer and gives us
   a permanent record. We accept the slower speed because selling a seat
   twice is worse than being a little slow. If the database became the
   bottleneck, we could add Redis in front, with the database still
   having the final word.
2. **Fresh seat map vs low load (cache).** A seat map that is 1-2
   seconds old may show a seat as free when it has just been taken.
   The user then gets `409 Conflict` when holding it. This is
   acceptable and keeps the database alive. The conditional update
   makes sure the stale map can never cause a double sale.
3. **Fairness vs convenience (waiting room).** The waiting room makes
   people wait, which feels slower, but it is fairer and protects the
   site from crashing for everyone.
4. **Hold time: long vs short.** A 5-minute hold gives people time to
   pay, but it locks seats other people want. A shorter hold
   releases seats faster but may cause failed payments.
5. **Single points of failure.** The load balancer, app servers, cache
   and workers are run in more than one copy. The database has a replica
   that can be promoted if the primary fails.