package internal

func Publish(repo *Repository, pkg *Package) error {

	// TODO needs clean / build / only necessary files
	// strippedName := stripName(pkg.Name)

	// packedDir := path.Join(repo.OutDir, "packed")
	// packedName := fmt.Sprintf("%s.tgz", strippedName)
	// packedPath := path.Join(packedDir, packedName)

	// access := "restricted"
	// if pkg.Publish == PublishPublicly {
	// 	access = "public"
	// }

	// npm := exec.Command("npm", "publish", packedPath, "--access", access)
	// npm.Stdin = os.Stdin
	// npm.Stdout = os.Stdout
	// npm.Stderr = os.Stderr
	// return npm.Run()
	return nil
}
