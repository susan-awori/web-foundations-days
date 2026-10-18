# SnapShare Scaling Plan

SnapShare is a photo-sharing app where users upload photos and scroll
a feed of photos from people they follow.

## 1. Assumptions

- 10 million registered users.
- 10% are active each day, so **1 million daily active users (DAU)**.
- Each active user uploads 1 photo per day.
- Each active user views 50 feed pages per day.
- An average photo is 2 MB. Each photo also gets a 50 KB thumbnail.
- A day has 86,400 seconds.
- Peak traffic is 5 times the average.
- 1 TB = 1,000 GB (to keep the maths simple).

## 2. Estimates

### Uploads
- Per day: 1,000,000 uploads.
- Average: 1,000,000 / 86,400 = about **12 uploads per second**.
- Peak: 12 x 5 = about **60 uploads per second**.

### Feed views
- Per day: 1,000,000 x 50 = 50,000,000 feed views.
- Average: 50,000,000 / 86,400 = about **580 views per second**.
- Peak: 580 x 5 = about **2,900 views per second**.

### Storage
- Photos per day: 1,000,000 x 2 MB = 2 TB.
- Thumbnails per day: 1,000,000 x 50 KB = 50 GB.
- Photos per year: 2 TB x 365 = **730 TB**.
- Thumbnails per year: 50 GB x 365 = about **18 TB**.
- Total per year: about **750 TB**.

## 3. Read-heavy or write-heavy?

SnapShare is **read-heavy**. There are about 580 feed views per second
but only about 12 uploads per second, a ratio of roughly 50 reads to 1
write. This means the design should make reads fast and cheap, using a
CDN, a cache and read replicas, while writes can go through a simpler
path with a queue.

## 4. Why photos do not go in the database

A photo is a large file (2 MB). Storing 750 TB of files in a database
would make it slow, expensive, and hard to back up and scale. Photos
go in **object storage**, which is cheap, durable and built for large
files. The database stores only small metadata, such as the photo id,
owner, caption, time and the **storage key (link)** to the file.

## 5. Architecture diagram

```text
                      +-------------+
                      |    Users    |
                      | (phone/web) |
                      +------+------+
                             |
              +--------------+--------------+
              |                             |
              v                             v
        +-----------+              +----------------+
        |    CDN    |<-------------| Object storage |
        | (photos & |   cache      | (originals &   |
        | thumbnails)|   misses    |  thumbnails)   |
        +-----------+              +----------------+
                             |                ^   ^
                             v                |   |
                    +-----------------+       |   |
                    |  Load balancer  |       |   |
                    +--------+--------+       |   |
                             |                |   |
               +-------------+-------------+  |   |
               |             |             |  |   |
               v             v             v  |   |
          +---------+   +---------+   +---------+ |
          |  App    |   |  App    |   |  App    | |
          | server 1|   | server 2|   | server 3| |
          +----+----+   +----+----+   +----+----+ |
               |             |             |      |
        +------+------+------+-------------+      |
        |             |                           |
        v             v                           |
   +---------+   +-----------+               +----+-----+
   |  Cache  |   |  Queue    |-------------->|  Worker  |
   | (Redis) |   | (thumbnail|  next job     | (makes   |
   +----+----+   |   jobs)   |               |thumbnails)|
        |        +-----------+               +----+-----+
        | cache miss                              |
        v                                         | saves thumbnail,
   +-----------------+   replication    +-------------------+
   | Primary database|----------------->|   Read replica    |
   |    (writes)     |                  |     (reads)       |
   +-----------------+                  +-------------------+
                                                  ^
                                                  |
                                   worker marks photo "ready"
                                   (written to the primary DB)
```

Reading the diagram: users ask the CDN for photo files and the
load balancer for everything else. App servers read from the cache or
the read replica, write to the primary database and object storage,
and put thumbnail jobs on the queue for the worker.

## 6. What each component does

- **CDN:** Solves slow photo loading for faraway users by serving
  popular photos and thumbnails from servers close to them.
- **Load balancer:** Solves one server being overloaded (or failing)
  by spreading requests across several app servers.
- **App servers:** Solve the need to run SnapShare's logic (login, feed,
  upload) and can be added in number to handle more traffic.
- **Cache:** Solves repeated slow database reads by keeping hot data,
  such as popular feeds, in fast memory.
- **Primary database:** Solves the need to store structured data
  (users, follows, photo metadata) reliably and handle all writes.
- **Read replica:** Solves read overload on the primary by serving a
  copy of the data for the many feed reads.
- **Object storage:** Solves storing 750 TB a year of photo files
  cheaply and durably, away from the database.
- **Queue:** Solves slow uploads by letting the app say "I will do the
  thumbnail later" and handing the job over instead of waiting.
- **Worker:** Solves the heavy work of resizing images by doing it in
  the background, away from user requests.

## 7. Upload flow, step by step

1. The user picks a photo and taps Upload in the app.
2. The request goes through the load balancer to an app server.
3. The app server checks the user is logged in and the file is valid
   (type and size).
4. The app server saves the original photo to object storage and
   receives its storage key.
5. The app server writes a row to the primary database with the photo
   id, owner, time, storage key and the status "processing".
6. The app server puts a "create thumbnail" job (with the photo id)
   on the queue.
7. The app server replies "Upload received" to the user straight away.
8. A worker takes the job from the queue, downloads the original and
   creates a 50 KB thumbnail.
9. The worker saves the thumbnail to object storage.
10. The worker updates the database row to "ready".
11. The cache entry for the user's followers' feeds is refreshed or
    expired, so the new photo appears.
12. Followers' feeds load the thumbnail through the CDN, which fetches
    it from object storage on the first request and caches it.

## 8. Trade-offs

1. **Fast reads vs fresh data (cache and read replica).** The cache and
   the read replica make the feed fast, but they can be a little behind
   the primary database. A new photo might not show in a follower's feed
   for a few seconds. We accept this because a social feed does not
   need to be instant, and speed matters more.
2. **Fast upload vs instant thumbnail (queue).** Using a queue makes the
   upload reply quickly and handles spikes smoothly. The cost is that
   the thumbnail is not ready the moment the upload finishes, so the
   photo may briefly show as "processing". It also adds another part
   to run and monitor.
3. **Cost vs speed (CDN and storage).** A CDN makes photos load faster
   but costs money for every gigabyte served. We could keep fewer
   copies or only cache popular photos to save money, but then some
   users would wait longer.
4. **Simplicity vs scale (many components).** Each extra part solves
   a real problem but makes the system harder to build, test and
   fix. At 12 uploads per second a single server might cope, but for
   750 TB a year and 2,900 views per second at peak, the extra parts
   are worth it.