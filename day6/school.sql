IF OBJECT_ID('enrolments', 'U') IS NOT NULL DROP TABLE enrolments;
IF OBJECT_ID('students', 'U') IS NOT NULL DROP TABLE students;
IF OBJECT_ID('courses', 'U') IS NOT NULL DROP TABLE courses;

CREATE TABLE students (
  id    INTEGER IDENTITY(1,1) PRIMARY KEY,
  name  NVARCHAR(100) NOT NULL,
  email NVARCHAR(255) NOT NULL UNIQUE
);

CREATE TABLE courses (
  id      INTEGER IDENTITY(1,1) PRIMARY KEY,
  title   NVARCHAR(150) NOT NULL,
  credits INTEGER NOT NULL
);

CREATE TABLE enrolments (
  id         INTEGER IDENTITY(1,1) PRIMARY KEY,
  student_id INTEGER NOT NULL,
  course_id  INTEGER NOT NULL,
  grade      INTEGER,
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (course_id)  REFERENCES courses(id),
  UNIQUE (student_id, course_id)
);

INSERT INTO students (name, email) VALUES
  ('Amina Otieno',  'amina@school.test'),
  ('Brian Kamau',   'brian@school.test'),
  ('Cynthia Wanjiru', 'cynthia@school.test'),
  ('Daniel Mwangi', 'daniel@school.test');

INSERT INTO courses (title, credits) VALUES
  ('Web Development', 4),
  ('Databases', 3),
  ('Algorithms', 4);

INSERT INTO enrolments (student_id, course_id, grade) VALUES
  (1, 1, 85),
  (1, 2, 78),
  (2, 1, 72),
  (2, 2, 65),
  (3, 1, 90),
  (3, 3, NULL);

  SELECT courses.title, enrolments.grade
FROM students
JOIN enrolments ON enrolments.student_id = students.id
JOIN courses    ON courses.id = enrolments.course_id
WHERE students.name = 'Amina Otieno';

SELECT students.name, students.email
FROM courses
JOIN enrolments ON enrolments.course_id = courses.id
JOIN students   ON students.id = enrolments.student_id
WHERE courses.title = 'Web Development';

SELECT courses.title, COUNT(enrolments.id) AS student_count
FROM courses
LEFT JOIN enrolments ON enrolments.course_id = courses.id
GROUP BY courses.id, courses.title;

SELECT students.name
FROM students
LEFT JOIN enrolments ON enrolments.student_id = students.id
WHERE enrolments.id IS NULL;

UPDATE enrolments
SET grade = 70
WHERE student_id = (SELECT id FROM students WHERE name = 'Brian Kamau')
  AND course_id  = (SELECT id FROM courses  WHERE title = 'Databases');

SELECT students.name, courses.title, enrolments.grade
FROM enrolments
JOIN students ON students.id = enrolments.student_id
JOIN courses  ON courses.id = enrolments.course_id
WHERE students.name = 'Brian Kamau';