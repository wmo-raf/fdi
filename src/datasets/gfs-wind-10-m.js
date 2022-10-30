export const name = "wind at 10 m above ground";

export const metadata = {};

export const grib2_options = {
  match: ":(U|V)GRD:10 m above ground",
  uMatch: ":UGRD:10 m above ground",
  vMatch: ":VGRD:10 m above ground",
  limit: 2,
};
