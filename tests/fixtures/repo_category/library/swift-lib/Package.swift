import PackageDescription
let package = Package(
  name: "lib",
  products: [ .library(name: "lib", targets: ["lib"]) ],
  targets: [ .target(name: "lib") ]
)
