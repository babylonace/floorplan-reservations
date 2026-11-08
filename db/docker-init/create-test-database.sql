-- Runs once, when the Docker volume is created. `npm test` uses floorplan_test and `npm run e2e`
-- uses floorplan_e2e; both wipe their database.
create database floorplan_test owner floorplan;
create database floorplan_e2e owner floorplan;
