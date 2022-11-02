export const name = `temperature at 2 m above ground`;

export const metadata = {
  unit: "tempC",
};

export const grib2_options = {
  match: ":TMP:2 m above ground",
};
