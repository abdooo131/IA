-- Runs once, after the postgis image's own init script, when the volume is first created.
-- The image also installs topology, tiger geocoder and fuzzystrmatch. We only use postgis,
-- and Prisma treats the extras as schema drift, so they are removed.
\connect template1
DROP EXTENSION IF EXISTS postgis_tiger_geocoder;
DROP EXTENSION IF EXISTS postgis_topology;
DROP EXTENSION IF EXISTS fuzzystrmatch;
CREATE EXTENSION IF NOT EXISTS postgis;

\connect shiplynow
DROP EXTENSION IF EXISTS postgis_tiger_geocoder;
DROP EXTENSION IF EXISTS postgis_topology;
DROP EXTENSION IF EXISTS fuzzystrmatch;
CREATE EXTENSION IF NOT EXISTS postgis;

-- Created from template1, so it gets postgis only.
CREATE DATABASE shiplynow_test;
