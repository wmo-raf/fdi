export const name = `mean sea level pressure`;

export const metadata = {
  unit: "Pa",
};

export const grib2_options = {
  match: ":PRMSL:mean sea level",
};
